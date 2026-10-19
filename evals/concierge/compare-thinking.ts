#!/usr/bin/env bun
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { runToolLoop, CONCIERGE_PROMPT_VERSION, type ChatThinkingMode } from '#features/chat/api/agent/orchestrate.ts'
import { AI_MODEL } from '#shared/lib/ai/constants.ts'
import { flushLangfuse } from '#shared/lib/ai/langfuse.server.ts'
import { CONVERSATIONS, type ConversationCase } from './conversations.ts'
import { DIRECTIONS_COMPLETION_CASES } from './directions-cases.ts'
import { runConversation, summarizeConversations, type ConversationResult } from './conversation-runner.ts'
import { CORPUS_HASH, CORPUS_VERSION, FROZEN_NOW } from './frozen-corpus.ts'
import { qualityPacket, qualityScores, QUALITY_RUBRIC_HASH, QUALITY_RUBRIC_VERSION } from './quality.ts'
import { judgeQuality, QualityGradeError } from './judge.ts'
import { mapWithConcurrency } from '../lib/checks.ts'

export const THINKING_MODES: ChatThinkingMode[] = ['adaptive', 'disabled']
export type ThinkingVariant = ChatThinkingMode | 'low-effort' | 'direct-directions'
export type GradeRow = { mode: ThinkingVariant; caseId: string; trial: number; index: number;
  status: 'graded' | 'error'; pass: boolean; scores?: ReturnType<typeof qualityScores>; durationMs: number;
  evidence?: Awaited<ReturnType<typeof judgeQuality>>; error?: string; attempts?: unknown[]; rejectedGrade?: unknown }
export type ThinkingResults = Record<ChatThinkingMode, ConversationResult[]> & Partial<Record<'low-effort' | 'direct-directions', ConversationResult[]>>

export function parseThinkingOptions(args: string[]) {
  const options = { trials: 3, caseId: '', candidate: 'disabled' as 'disabled' | 'low-effort' | 'direct-directions', skipQuality: false, help: false }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help') options.help = true
    else if (arg === '--skip-quality') options.skipQuality = true
    else if (arg === '--trials' || arg === '--case' || arg === '--candidate') {
      const value = args[++i]
      if (!value || value.startsWith('--')) throw new Error(`Missing ${arg}`)
      if (arg === '--candidate') {
        if (value !== 'disabled' && value !== 'low-effort' && value !== 'direct-directions') throw new Error('--candidate must be disabled, low-effort or direct-directions')
        options.candidate = value
      } else if (arg === '--case') options.caseId = value
      else {
        const trials = Number(value)
        if (!Number.isInteger(trials) || trials < 1 || trials > 5) throw new Error('--trials must be 1..5')
        options.trials = trials
      }
    } else throw new Error(`Unknown option ${arg}`)
  }
  return options
}

/** Alternate whole conversations, preserving each variant's actual history. */
export function thinkingSchedule(cases: ConversationCase[], trials: number, modes: ThinkingVariant[] = THINKING_MODES) {
  return Array.from({ length: trials }, (_, trial) => cases.flatMap((scenario, index) =>
    ((trial + index) % 2 ? [...modes].reverse() : modes).map(mode => ({ caseId: scenario.id, trial: trial + 1, mode })))).flat()
}

function distribution(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0).sort((a, b) => a - b)
  const percentile = (p: number) => valid.length ? valid[Math.max(0, Math.ceil(valid.length * p) - 1)] : null
  return { measured: valid.length, unknown: values.length - valid.length, p50: percentile(.5), p95: percentile(.95), max: valid.at(-1) ?? null }
}

export function summarizeThinking(results: ThinkingResults, grades: GradeRow[], cases: ConversationCase[], trials: number, modes: ThinkingVariant[] = THINKING_MODES) {
  const expectedTurns = cases.reduce((n, c) => n + c.turns.length, 0) * trials
  return Object.fromEntries(modes.map(mode => {
    const runs = results[mode] ?? []
    const conversations = summarizeConversations(runs, cases, trials)
    const turns = runs.flatMap(run => run.turns)
    const complete = conversations.every(item => item.completedTrials === trials) && runs.length === cases.length * trials &&
      runs.every(run => { const scenario = cases.find(c => c.id === run.caseId); return scenario && run.trial >= 1 && run.trial <= trials && run.turns.length === scenario.turns.length &&
        run.turns.every((turn, i) => turn.index === i && turn.message === scenario.turns[i].message && turn.run) }) &&
      new Set(runs.map(run => `${run.caseId}:${run.trial}`)).size === cases.length * trials
    const ownGrades = grades.filter(grade => grade.mode === mode)
    const gradeComplete = complete && ownGrades.length === expectedTurns && new Set(ownGrades.map(g => `${g.caseId}:${g.trial}:${g.index}`)).size === expectedTurns &&
      runs.every(run => run.turns.every(turn => ownGrades.some(g => g.caseId === run.caseId && g.trial === run.trial && g.index === turn.index && g.status === 'graded')))
    return [mode, { expectedTurns, complete, contractPassed: conversations.every(item => item.allTrialsPass) && complete && !turns.some(turn => turn.run?.canonical.provenance.fallbackUsed),
      contractPassTurns: turns.filter(turn => turn.pass).length, fallbackTurns: turns.filter(turn => turn.run?.canonical.provenance.fallbackUsed).length,
      completionMs: distribution(turns.map(turn => turn.run?.timing?.completionMs)),
      firstArtifactMs: distribution(turns.map(turn => turn.run?.timing?.firstUsefulMs)),
      firstGroundedTextMs: distribution(turns.map(turn => turn.run?.timing?.firstGroundedTextMs)),
      quality: { calibration: 'uncalibrated', complete: gradeComplete, passed: gradeComplete && ownGrades.every(grade => grade.pass),
        passedTurns: ownGrades.filter(grade => grade.pass).length, errorTurns: ownGrades.filter(grade => grade.status === 'error').length },
      conversations }]
  }))
}

async function main() {
  const options = parseThinkingOptions(process.argv.slice(2))
  if (options.help) { console.log('bun run eval:concierge:thinking [--candidate disabled|low-effort|direct-directions] [--trials 1..5] [--case ID] [--skip-quality]'); return }
  if (Number(process.env.DEEPSEEK_FLASH_CANARY_PERCENT ?? 0) !== 0) throw new Error('Disable model canary routing for a controlled comparison')
  const available = options.candidate === 'direct-directions' ? [...CONVERSATIONS, ...DIRECTIONS_COMPLETION_CASES] : CONVERSATIONS
  const cases = options.caseId ? available.filter(c => c.id === options.caseId) : options.candidate === 'direct-directions' ? DIRECTIONS_COMPLETION_CASES : CONVERSATIONS
  if (!cases.length) throw new Error('Unknown conversation case')
  const runId = randomUUID(), hash = (value: string) => createHash('sha256').update(value).digest('hex')
  const directory = new URL('../../results/evals/concierge/', import.meta.url)
  await mkdir(directory, { recursive: true })
  const path = new URL(`thinking-${runId}.json`, directory)
  const modes: ThinkingVariant[] = ['adaptive', options.candidate]
  const results: ThinkingResults = { adaptive: [], disabled: [], 'low-effort': [], 'direct-directions': [] }, grades: GradeRow[] = []
  const metadata = { runId, measuredAt: new Date().toISOString(), suiteVersion: 'thinking-comparison-v2', trials: options.trials, comparisonModes: modes,
    casesHash: hash(JSON.stringify(cases)), corpusVersion: CORPUS_VERSION, corpusHash: CORPUS_HASH, frozenNow: FROZEN_NOW,
    configuredModel: AI_MODEL, promptVersion: CONCIERGE_PROMPT_VERSION, wireModes: { adaptive: 'enabled', disabled: 'disabled', 'low-effort': 'enabled', 'direct-directions': 'enabled' },
    candidateReasoningEffort: options.candidate === 'low-effort' ? 'low' : null,
    orchestrationHash: hash(await readFile(new URL('../../src/features/chat/api/agent/orchestrate.ts', import.meta.url), 'utf8')),
    harnessHash: hash(await readFile(new URL('./compare-thinking.ts', import.meta.url), 'utf8')),
    qualityRubricVersion: QUALITY_RUBRIC_VERSION, qualityRubricHash: QUALITY_RUBRIC_HASH,
    judgeModel: AI_MODEL, judgeCalibration: 'uncalibrated', generationConcurrency: 1, gradingConcurrency: 2,
    transport: 'shared production stream callback with frozen reads; excludes HTTP/delivery/database',
    firstTextDefinition: 'text after a successful authoritative read; may include template acknowledgement; not independently verified until graded',
    qualitySkipped: options.skipQuality, productionSettingsChanged: false }
  let writes = Promise.resolve()
  const save = () => {
    const payload = JSON.stringify({ metadata, summary: summarizeThinking(results, grades, cases, options.trials, modes), results, grades }, null, 2)
    const write = writes.then(() => writeFile(path, payload))
    writes = write.catch(() => {})
    return write
  }
  for (const item of thinkingSchedule(cases, options.trials, modes)) {
    const scenario = cases.find(c => c.id === item.caseId)!
    const result = await runConversation(scenario, item.trial, { runAgentFn: input => runToolLoop(input,
      item.mode === 'low-effort' ? { reasoningEffort: 'low' } : item.mode === 'direct-directions' ? { completeDirections: true } : { thinking: item.mode }) })
    results[item.mode]!.push(result)
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${item.mode} ${item.caseId} trial ${item.trial}: ${result.turns.map(t => `${t.run?.timing?.completionMs ?? '?'}ms`).join(', ')}`)
    for (const turn of result.turns.filter(turn => !turn.pass)) console.log(`  turn ${turn.index + 1}: ${turn.failures.join('; ')}`)
    await save()
  }
  if (!options.skipQuality) {
    const items = modes.flatMap(mode => results[mode]!.flatMap(run => run.turns.map(turn => ({ mode, run, turn }))))
    await mapWithConcurrency(items, 2, async ({ mode, run, turn }) => {
      const started = performance.now(), identity = { mode, caseId: run.caseId, trial: run.trial, index: turn.index }
      try {
        const locale = cases.find(c => c.id === run.caseId)!.locale
        if (!turn.run) throw new Error('Missing completed turn')
        const packet = qualityPacket(turn.message, locale, turn.run)
        // The existing judge receives evidence and prose, without the variant label.
        const judged = await judgeQuality(packet, AI_MODEL)
        const scores = qualityScores(turn.run, judged.grade)
        const pass = turn.pass && !turn.run.canonical.provenance.fallbackUsed && Object.entries(scores).every(([key, value]) => value === null || value >= (['suitability', 'usefulness'].includes(key) ? 2 : 1))
        grades.push({ ...identity, status: 'graded', pass, scores, durationMs: Math.round(performance.now() - started), evidence: judged })
      } catch (error) {
        grades.push({ ...identity, status: 'error', pass: false, error: 'Missing evidence or judge protocol/request failed', durationMs: Math.round(performance.now() - started),
          ...(error instanceof QualityGradeError ? { rejectedGrade: error.candidate, attempts: error.attempts } : {}) })
      }
      console.log(`QUALITY ${grades.at(-1)!.pass ? 'PASS' : 'REVIEW'} ${mode} ${run.caseId}/${run.trial}/${turn.index + 1}`)
      await save()
    })
  }
  await save()
  const summary = summarizeThinking(results, grades, cases, options.trials, modes)
  console.log(JSON.stringify(summary, null, 2)); console.log(`Report: ${path.pathname}`)
  if (Object.values(summary).some(value => !value.contractPassed || !value.quality.passed)) process.exitCode = 1
}

if (import.meta.main) {
  try { await main() } catch { console.error('Thinking comparison failed; inspect saved partial receipt'); process.exitCode = 1 }
  finally { await flushLangfuse() }
}
