import { describe, expect, it } from 'vitest'
import { parseThinkingOptions, thinkingSchedule, summarizeThinking, type ThinkingResults, type GradeRow } from '../../../../../evals/concierge/compare-thinking.ts'
import type { ConversationCase } from '../../../../../evals/concierge/conversations.ts'
import { adaptStoredMessageToCanonical } from '#features/chat/lib/canonical.ts'

const scenario: ConversationCase = { id: 'simple', locale: 'en', turns: [{ message: 'Hello', expect: { kind: 'out_of_scope' } }] }
function fixture() {
  const results: ThinkingResults = { adaptive: [], disabled: [] }
  const grades: GradeRow[] = []
  for (const mode of ['adaptive', 'disabled'] as const) {
    results[mode].push({ caseId: scenario.id, trial: 1, sessionId: mode, pass: true,
      turns: [{ index: 0, message: 'Hello', pass: true, failures: [], durationMs: 5,
        run: { text: 'Hello', events: [], toolCalls: [], stepCount: 1, cardsGrounded: true,
          canonical: adaptStoredMessageToCanonical({ id: mode, content: 'Hello' }),
          timing: { transport: 'stream', completionMs: mode === 'disabled' ? 0 : 10, firstUsefulMs: null } } }] })
    grades.push({ mode, caseId: scenario.id, trial: 1, index: 0, status: 'graded', pass: true, durationMs: 500 })
  }
  return { results, grades }
}
describe('thinking mode comparison', () => {
  it('alternates paired conversations and never mixes their state', () => {
    const schedule = thinkingSchedule([scenario], 3)
    expect(schedule.map(row => row.mode)).toEqual(['adaptive', 'disabled', 'disabled', 'adaptive', 'adaptive', 'disabled'])
    expect(schedule.map(row => row.trial)).toEqual([1, 1, 2, 2, 3, 3])
  })
  it('includes failed turns in timing and keeps missing first output unknown and actual zero intact', () => {
    const { results, grades } = fixture()
    results.disabled[0].pass = false; results.disabled[0].turns[0].pass = false
    const summary = summarizeThinking(results, grades, [scenario], 1)
    expect(summary.disabled.contractPassed).toBe(false)
    expect(summary.disabled.completionMs).toMatchObject({ p50: 0, measured: 1 })
    expect(summary.disabled.firstArtifactMs).toMatchObject({ p50: null, measured: 0, unknown: 1 })
    expect(summary.adaptive.completionMs.p50).toBe(10) // grading's 500 ms is separate
  })
  it('fails missing, duplicate, mismatched or out-of-range trials and incomplete quality', () => {
    const { results, grades } = fixture()
    expect(summarizeThinking(results, grades, [scenario], 1).adaptive.quality.passed).toBe(true)
    expect(summarizeThinking(results, [], [scenario], 1).adaptive.quality.passed).toBe(false)
    results.adaptive.push(results.adaptive[0])
    expect(summarizeThinking(results, grades, [scenario], 1).adaptive.contractPassed).toBe(false)
    results.adaptive.pop(); results.adaptive[0].trial = 2
    expect(summarizeThinking(results, grades, [scenario], 1).adaptive.contractPassed).toBe(false)
    expect(summarizeThinking(results, grades, [scenario], 1).adaptive.complete).toBe(false)
    results.adaptive[0].trial = 1; results.adaptive[0].turns[0].message = 'Different prompt'
    expect(summarizeThinking(results, grades, [scenario], 1).adaptive.complete).toBe(false)
  })
  it('treats judge protocol errors as failures, not missing non-applicable scores', () => {
    const { results, grades } = fixture()
    grades[0] = { ...grades[0], status: 'error', pass: false }
    expect(summarizeThinking(results, grades, [scenario], 1).adaptive.quality).toMatchObject({ complete: false, passed: false, errorTurns: 1 })
    results.disabled[0].turns[0].run!.canonical.provenance.fallbackUsed = true
    expect(summarizeThinking(results, grades, [scenario], 1).disabled.contractPassed).toBe(false)
  })
  it('bounds opt-in live workloads', () => {
    expect(parseThinkingOptions([])).toMatchObject({ trials: 3, skipQuality: false })
    for (const args of [['--trials', '0'], ['--trials', '6'], ['--case'], ['--typo']]) expect(() => parseThinkingOptions(args)).toThrow()
    expect(parseThinkingOptions(['--candidate', 'low-effort'])).toMatchObject({ candidate: 'low-effort', trials: 3 })
    expect(() => parseThinkingOptions(['--candidate', 'fast'])).toThrow()
    expect(thinkingSchedule([scenario], 2, ['adaptive', 'low-effort']).map(row => row.mode)).toEqual(['adaptive', 'low-effort', 'low-effort', 'adaptive'])
    const { results, grades } = fixture()
    results['low-effort'] = results.disabled
    const summary = summarizeThinking(results, grades.map(g => g.mode === 'disabled' ? { ...g, mode: 'low-effort' as const } : g), [scenario], 1, ['adaptive', 'low-effort'])
    expect(Object.keys(summary)).toEqual(['adaptive', 'low-effort'])
    expect(summary['low-effort'].contractPassed).toBe(true)
  })
})
