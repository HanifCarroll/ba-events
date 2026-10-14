#!/usr/bin/env bun
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { LangfuseClient, type Evaluation } from '@langfuse/client'
import { initializeLangfuse, flushLangfuse, langfuseConfigured } from '#shared/lib/ai/langfuse.server.ts'
import { AI_MODEL } from '#shared/lib/ai/constants.ts'
import { mapWithConcurrency } from '../lib/checks.ts'
import { parseMultiTurnOptions, experimentScoresMatch } from './multi-turn.ts'
import { summarizeConversations } from './conversation-runner.ts'
import { INJECTION_CASES, INJECTION_SUITE_VERSION, injectionFixture, runInjectionCase, type InjectionResult } from './injection.ts'
import { CORPUS_HASH, FROZEN_NOW } from './frozen-corpus.ts'

async function main() {
  const options = parseMultiTurnOptions(process.argv.slice(2))
  if (options.help) { console.log('bun run eval:concierge:injection [--case ID] [--trials 1..10] [--concurrency 1..4] [--langfuse]'); return }
  const probes = options.caseId ? INJECTION_CASES.filter(probe => probe.id === options.caseId) : INJECTION_CASES
  if (!probes.length) throw new Error(`Unknown injection case: ${options.caseId}`)
  const runId = randomUUID()
  const hash = createHash('sha256')
  for (const path of ['injection.ts', 'conversation-runner.ts', 'frozen-corpus.ts', '../../src/features/chat/api/agent/orchestrate.ts']) {
    hash.update(path); hash.update(await readFile(new URL(path, import.meta.url)))
  }
  const metadata = { runId, suiteVersion: INJECTION_SUITE_VERSION, graderVersion: 'injection-contract-v1',
    frozenNow: FROZEN_NOW, baseCorpusHash: CORPUS_HASH, fixtureHashes: Object.fromEntries(probes.map(probe => [probe.id, injectionFixture(probe).hash])),
    sourceHash: hash.digest('hex'), configuredModel: AI_MODEL, canaryPercent: process.env.DEEPSEEK_FLASH_CANARY_PERCENT ?? '0',
    release: process.env.LANGFUSE_RELEASE ?? 'local', trials: options.trials, concurrency: options.concurrency }
  const data = probes.flatMap(probe => Array.from({ length: options.trials }, (_, index) => ({ input: { caseId: probe.id, trial: index + 1 } })))
  const execute = async (input: { caseId: string; trial: number }) => {
    const probe = probes.find(probe => probe.id === input.caseId)
    if (!probe) throw new Error('Unknown injection experiment input')
    const result = await runInjectionCase(probe, input.trial)
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.caseId} trial ${input.trial}/${options.trials}; attack ${result.attackExposed ? 'exposed' : 'not exposed'}`)
    for (const turn of result.turns.filter(turn => !turn.pass)) console.log(`  turn ${turn.index + 1}: ${turn.failures.join('; ')}`)
    return result
  }
  let results: InjectionResult[] = []
  let scoresComplete = !options.langfuse
  let experimentReceipt: { runName: string; traces: Array<{ caseId: string; trial: number; traceId?: string }> } | undefined
  try {
    if (options.langfuse) {
      if (!langfuseConfigured() || !await initializeLangfuse()) throw new Error('Configured, enabled Langfuse tracing is required for --langfuse')
      const experiment = await new LangfuseClient().experiment.run<{ caseId: string; trial: number }>({
        name: 'BA Eventos malicious-source conversations', data, metadata, maxConcurrency: options.concurrency,
        task: ({ input }) => execute(input as { caseId: string; trial: number }),
        evaluators: [async ({ output }): Promise<Evaluation[]> => {
          const result = output as InjectionResult
          return [{ name: 'attack_exposed', value: Number(result.attackExposed) }, { name: 'conversation_pass', value: Number(result.pass) },
            ...result.turns.map(turn => ({ name: `turn_${turn.index + 1}_pass`, value: Number(turn.pass) }))]
        }],
      })
      results = experiment.itemResults.map(item => item.output as InjectionResult)
      scoresComplete = experimentScoresMatch(experiment.itemResults, data.length) && experiment.itemResults.every(item =>
        item.evaluations.filter(score => score.name === 'attack_exposed').length === 1
        && item.evaluations.find(score => score.name === 'attack_exposed')?.value === Number(item.output.attackExposed))
      experimentReceipt = { runName: experiment.runName, traces: experiment.itemResults.map(item => ({
        caseId: item.output.caseId, trial: item.output.trial, traceId: item.traceId,
      })) }
    } else results = await mapWithConcurrency(data, options.concurrency, item => execute(item.input))
  } finally {
    const summary = summarizeConversations(results, probes.map(probe => injectionFixture(probe).scenario), options.trials)
    const passed = summary.every(item => item.allTrialsPass) && scoresComplete
    const directory = new URL('../../results/evals/concierge/', import.meta.url)
    await mkdir(directory, { recursive: true })
    const path = new URL(`injection-${runId}.json`, directory)
    await writeFile(path, JSON.stringify({ metadata, passed, scoresComplete, summary, experiment: experimentReceipt, results }, null, 2))
    console.log(`Report: ${path.pathname}`)
    if (!passed) process.exitCode = 1
  }
}

if (import.meta.main) {
  try { await main() }
  catch { console.error('Injection evaluation failed; inspect the retained receipt and configuration.'); process.exitCode = 1 }
  finally { await flushLangfuse() }
}
