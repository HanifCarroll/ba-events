#!/usr/bin/env bun
import { LangfuseClient, type Evaluation, type ExperimentItem } from '@langfuse/client'
import { initializeLangfuse, flushLangfuse, langfuseConfigured } from '#shared/lib/ai/langfuse.server.ts'
import { runConcierge, type AgentRun, type ConciergeEvalContext } from '../lib/run-agent.ts'
import { CONCIERGE_CASES } from './cases.ts'
import { scoreCase } from './score.ts'
import { currentDateInBuenosAires } from '#features/chat/api/agent/search-context.ts'
import { REPLY_LANGUAGE_VERSION } from './language.ts'

interface EvalInput {
  caseId: string
  message: string
  locale: 'en' | 'es'
  context?: Partial<ConciergeEvalContext>
}

function findCase(caseId: string) {
  const testCase = CONCIERGE_CASES.find((item) => item.id === caseId)
  if (!testCase) throw new Error(`Unknown concierge case: ${caseId}`)
  return testCase
}

async function main() {
  if (!langfuseConfigured()) throw new Error('Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY before running live evals')
  // Experiments require a real tracer even if ordinary production tracing is disabled.
  if (!await initializeLangfuse()) throw new Error('Langfuse tracing must be enabled for experiments')
  const filter = process.argv[2]
  const cases = filter ? CONCIERGE_CASES.filter((item) => item.id === filter) : CONCIERGE_CASES
  if (!cases.length) throw new Error(`Unknown concierge case: ${filter}`)
  const currentDateInBA = process.env.EVAL_DATE_IN_BA ?? currentDateInBuenosAires()
  const langfuse = new LangfuseClient()
  const data: ExperimentItem<EvalInput>[] = cases.map((item) => ({
    input: { caseId: item.id, message: item.message, locale: item.locale, context: { currentDateInBA } },
    metadata: { caseId: item.id },
  }))
  const result = await langfuse.experiment.run<EvalInput>({
    name: 'BA Eventos concierge',
    data,
    maxConcurrency: 2,
    metadata: {
      suiteVersion: 'concierge-v1',
      evaluatorVersion: 'deterministic-v2',
      replyLanguageVersion: REPLY_LANGUAGE_VERSION,
      release: process.env.LANGFUSE_RELEASE ?? 'local',
      currentDateInBA,
      corpus: 'live-database',
    },
    task: async ({ input: rawInput }) => {
      const input = rawInput as EvalInput | undefined
      if (!input) throw new Error('Missing concierge experiment input')
      findCase(input.caseId)
      return runConcierge(input.message, input.locale, input.context)
    },
    evaluators: [async ({ input, output }): Promise<Evaluation[]> => {
      const run = output as AgentRun
      const score = scoreCase({ ...findCase(input.caseId), message: input.message, locale: input.locale }, run)
      return [
        { name: 'case_pass', value: Number(score.pass), comment: score.failures.join('; ') || 'All checks passed' },
        { name: 'cards_grounded', value: Number(run.cardsGrounded) },
        { name: 'model_steps', value: run.stepCount },
      ]
    }],
  })
  console.log(await result.format({ includeItemResults: true }))
  // Task/evaluator errors and absent scores must fail the gate, too.
  if (result.itemResults.length !== cases.length || result.itemResults.some((item) =>
    !item.evaluations.some((score) => score.name === 'case_pass' && score.value === 1)
  )) process.exitCode = 1
}

try { await main() }
catch (error) { console.error(error instanceof Error ? error.message : 'Experiment failed'); process.exitCode = 1 }
finally { await flushLangfuse() }
