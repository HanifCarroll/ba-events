#!/usr/bin/env bun
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { LangfuseClient, type Evaluation, type ExperimentItem } from '@langfuse/client'
import { initializeLangfuse, flushLangfuse, langfuseConfigured } from '#shared/lib/ai/langfuse.server.ts'
import { AI_MODEL } from '#shared/lib/ai/constants.ts'
import { mapWithConcurrency } from '../lib/checks.ts'
import { CONVERSATIONS } from './conversations.ts'
import { HISTORY_STRESS_MESSAGES, HISTORY_STRESS_VERSION, runConversation, summarizeConversations, type ConversationResult } from './conversation-runner.ts'
import { MAX_AGENT_HISTORY_TOTAL_TEXT } from '#features/chat/api/agent/history.ts'
import { CORPUS_VERSION, CORPUS_HASH, FROZEN_NOW } from './frozen-corpus.ts'
import { REPLY_LANGUAGE_VERSION } from './language.ts'

export function parseMultiTurnOptions(args: string[]) {
  const options = { trials: 3, concurrency: 2, langfuse: false, caseId: '', help: false, historyStress: false }
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--langfuse') options.langfuse = true
    else if (argument === '--history-stress') options.historyStress = true
    else if (argument === '--help') options.help = true
    else if (['--trials', '--concurrency', '--case'].includes(argument)) {
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`)
      if (argument === '--case') options.caseId = value
      else {
        const number = Number(value)
        const maximum = argument === '--trials' ? 10 : 4
        if (!Number.isInteger(number) || number < 1 || number > maximum) throw new Error(`${argument} must be an integer from 1 to ${maximum}`)
        if (argument === '--trials') options.trials = number
        else options.concurrency = number
      }
    } else throw new Error(`Unknown option: ${argument}`)
  }
  return options
}

export function experimentScoresMatch(items: Array<{ output: ConversationResult | undefined; evaluations: Evaluation[] }>, expectedItems: number): boolean {
  return items.length === expectedItems && items.every(item => {
    if (!item.output) return false
    const expected = [
      { name: 'conversation_pass', value: Number(item.output.pass) },
      ...item.output.turns.map(turn => ({ name: `turn_${turn.index + 1}_pass`, value: Number(turn.pass) })),
    ]
    return expected.every(score => {
      const matches = item.evaluations.filter(actual => actual.name === score.name)
      return matches.length === 1 && matches[0].value === score.value
    })
  })
}

async function main() {
  const options = parseMultiTurnOptions(process.argv.slice(2))
  if (options.help) {
    console.log('bun run eval:concierge:multi [--case ID] [--trials 1..10] [--concurrency 1..4] [--langfuse] [--history-stress]')
    return
  }
  const cases = options.caseId ? CONVERSATIONS.filter(scenario => scenario.id === options.caseId) : CONVERSATIONS
  if (!cases.length) throw new Error(`Unknown conversation case: ${options.caseId}`)
  const runId = randomUUID()
  const hash = (value: string) => createHash('sha256').update(value).digest('hex')
  const source = await readFile(new URL('../../src/features/chat/api/agent/orchestrate.ts', import.meta.url), 'utf8')
  const metadata = {
    runId, suiteVersion: 'concierge-multi-v1', evaluatorVersion: 'conversation-deterministic-v2',
    replyLanguageVersion: REPLY_LANGUAGE_VERSION,
    modelEvidenceVersion: 'model-evidence-v1',
    performanceVersion: 'conversation-performance-v1', modelTransport: 'stream',
    performanceSourceHash: hash((await readFile(new URL('./conversation-runner.ts', import.meta.url), 'utf8')) +
      (await readFile(new URL('../lib/run-agent.ts', import.meta.url), 'utf8'))),
    corpusVersion: CORPUS_VERSION, corpusHash: CORPUS_HASH, frozenNow: FROZEN_NOW,
    casesHash: hash(JSON.stringify(cases)), orchestrationSourceHash: hash(source),
    configuredModel: AI_MODEL, canaryPercent: process.env.DEEPSEEK_FLASH_CANARY_PERCENT ?? '0',
    release: process.env.LANGFUSE_RELEASE ?? 'local', trials: options.trials,
    concurrency: options.concurrency,
    historyStress: options.historyStress ? { version: HISTORY_STRESS_VERSION,
      seedHash: hash(JSON.stringify(HISTORY_STRESS_MESSAGES)), seedMessages: HISTORY_STRESS_MESSAGES.length,
      seedChars: HISTORY_STRESS_MESSAGES.reduce((sum, message) => sum + message.content.length, 0),
      retainedTextLimit: MAX_AGENT_HISTORY_TOTAL_TEXT } : null,
  }
  const data: ExperimentItem<{ caseId: string; trial: number }>[] = cases.flatMap(scenario =>
    Array.from({ length: options.trials }, (_, index) => ({ input: { caseId: scenario.id, trial: index + 1 } })))
  const execute = async (input: { caseId: string; trial: number }) => {
    const scenario = cases.find(scenario => scenario.id === input.caseId)
    if (!scenario) throw new Error(`Missing scenario ${input.caseId}`)
    const result = await runConversation(scenario, input.trial, { historyStress: options.historyStress })
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.caseId} trial ${input.trial}/${options.trials}`)
    for (const turn of result.turns.filter(turn => !turn.pass)) console.log(`  turn ${turn.index + 1}: ${turn.failures.join('; ')}`)
    return result
  }
  console.log(`Running ${data.length} independent conversation trials against ${CORPUS_VERSION} (${CORPUS_HASH.slice(0, 12)}).`)
  let results: ConversationResult[]
  let experimentScoresComplete = true
  let experimentReceipt: { runName: string; traces: Array<{ caseId: string; trial: number; traceId?: string }> } | undefined
  if (options.langfuse) {
    if (!langfuseConfigured() || !await initializeLangfuse()) throw new Error('Configured, enabled Langfuse tracing is required for --langfuse')
    const experiment = await new LangfuseClient().experiment.run<{ caseId: string; trial: number }>({
      name: 'BA Eventos multi-turn frozen corpus', data, metadata, maxConcurrency: options.concurrency,
      task: ({ input }) => execute(input as { caseId: string; trial: number }),
      evaluators: [async ({ output }): Promise<Evaluation[]> => {
        const result = output as ConversationResult
        return [
          { name: 'conversation_pass', value: Number(result.pass), comment: result.turns.flatMap(turn => turn.failures.map(failure => `turn ${turn.index + 1}: ${failure}`)).join('; ') || 'All turns passed' },
          ...result.turns.map(turn => ({ name: `turn_${turn.index + 1}_pass`, value: Number(turn.pass), comment: turn.failures.join('; ') || 'Passed' })),
        ]
      }],
    })
    results = experiment.itemResults.filter(item => item.output).map(item => item.output as ConversationResult)
    experimentScoresComplete = experimentScoresMatch(experiment.itemResults, data.length)
    experimentReceipt = { runName: experiment.runName, traces: experiment.itemResults.map(item => {
      // Local experiment results do not populate top-level input consistently.
      const identity = (item.output ?? item.item.input) as { caseId: string; trial: number }
      return { caseId: identity.caseId, trial: identity.trial, traceId: item.traceId }
    }) }
  } else results = await mapWithConcurrency(data, options.concurrency, item => execute(item.input as { caseId: string; trial: number }))

  const summary = summarizeConversations(results, cases, options.trials)
  const passed = summary.every(item => item.allTrialsPass) && experimentScoresComplete
  const receipt = { metadata, passed, experimentScoresComplete, experiment: experimentReceipt, summary, results }
  const directory = new URL('../../results/evals/concierge/', import.meta.url)
  await mkdir(directory, { recursive: true })
  const path = new URL(`${runId}.json`, directory)
  await writeFile(path, JSON.stringify(receipt, null, 2))
  console.log(JSON.stringify(summary, null, 2))
  console.log(`Report: ${path.pathname}`)
  if (!passed) process.exitCode = 1
}

if (import.meta.main) {
  try { await main() }
  catch (error) { console.error(error instanceof Error ? error.message : 'Multi-turn evaluation failed'); process.exitCode = 1 }
  finally { await flushLangfuse() }
}
