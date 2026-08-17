import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('./work-loop.ts', () => ({ runWorkLoop: vi.fn() }))
vi.mock('./finalizer.ts', () => ({ runFinalizer: vi.fn() }))
vi.mock('../topic-guard.ts', () => ({ guardForOffTopic: vi.fn(async () => null) }))
vi.mock('../tools/coverage-guard.ts', () => ({ guardCoverageClaims: vi.fn((text: string) => text) }))

import { orchestrate } from './orchestrate.ts'
import { runWorkLoop } from './work-loop.ts'
import { runFinalizer } from './finalizer.ts'
import { guardCoverageClaims } from '../tools/coverage-guard.ts'
import { guardForOffTopic } from '../topic-guard.ts'
import type { WorkLoopResult } from './work-loop.ts'
import { Ledger } from './ledger.ts'
import { searchEntry, savedEventsEntry, mutationEntry, event, ledgerFrom } from './_test-helpers.ts'
import type { FinalizerPlan } from './finalizer.ts'
import type { SearchEventsInput } from '../tools/search-events.ts'

const mockedRunWorkLoop = vi.mocked(runWorkLoop)
const mockedRunFinalizer = vi.mocked(runFinalizer)
const mockedGuardCoverage = vi.mocked(guardCoverageClaims)
const mockedGuardForOffTopic = vi.mocked(guardForOffTopic)

function workResult(ledger: Ledger, steps: WorkLoopResult['steps'] = [], finalWorkCalledTools = false): WorkLoopResult {
  return {
    ledger,
    steps,
    workNotes: [],
    providerRequestIds: ['prov-1'],
    stopReason: finalWorkCalledTools ? 'budget_exhausted' : 'no_tool_calls',
    finalWorkCalledTools,
  }
}

function validPlan(overrides: Partial<FinalizerPlan> = {}): FinalizerPlan {
  return {
    contractVersion: 3,
    kind: 'recommendations',
    text: 'Go to Tango night.',
    eventSelections: [{ eventId: 'tango', sourceToolCallId: 's1' }],
    directionsToolCallId: null,
    venueToolCallId: null,
    suggestionSourceToolCallId: null,
    operationToolCallIds: [],
    ...overrides,
  }
}

const baseInput = {
  requestId: 'req-1',
  modelMessages: [],
  userContext: { userId: null, isAuthenticated: false },
  locale: 'en' as const,
  systemPrompt: 'concierge',
  originalQuery: 'romantic weekday night',
  priorDisplayedEvents: [],
}

describe('orchestrate (romantic weekday regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('selects the final tango pick, excludes the rejected speed-dating card, and always runs the finalizer', async () => {
    const ledger = ledgerFrom([
      searchEntry({ stepIndex: 0, callIndex: 0, toolCallId: 's0', events: [event('speed1', 'Speed dating')], limit: 1 }),
      searchEntry({ stepIndex: 1, callIndex: 0, toolCallId: 's1', events: [event('tango', 'Tango night'), event('music', 'Live music'), event('jazz', 'Jazz set')], limit: 3 }),
      searchEntry({ stepIndex: 2, callIndex: 0, toolCallId: 's2', events: [event('tango', 'Tango night')], limit: 1 }),
    ])

    mockedRunWorkLoop.mockResolvedValue(workResult(ledger, [], true))
    mockedRunFinalizer.mockResolvedValue({
      ok: true,
      plan: validPlan({ eventSelections: [{ eventId: 'tango', sourceToolCallId: 's1' }] }),
    })

    const result = await orchestrate(baseInput)

    expect(mockedRunFinalizer).toHaveBeenCalledTimes(1)
    expect(result.finalWorkCalledTools).toBe(true)
    expect(result.canonical.events.map((e) => e.id)).toEqual(['tango'])
    expect(result.canonical.events.map((e) => e.id)).not.toContain('speed1')
    expect(result.canonical.text.length).toBeGreaterThan(0)
    expect(result.canonical.provenance.fallbackUsed).toBe(false)
    expect(result.canonical.provenance.origin).toBe('validated')
    for (const step of result.executionTrace) {
      expect(step.text).toBe('')
    }
  })

  it('falls back deterministically when the finalizer plan is invalid, never showing rejected cards', async () => {
    const ledger = ledgerFrom([
      searchEntry({ stepIndex: 0, callIndex: 0, toolCallId: 's0', events: [event('speed1', 'Speed dating')], limit: 1 }),
      searchEntry({ stepIndex: 1, callIndex: 0, toolCallId: 's1', events: [event('tango', 'Tango night')], limit: 1 }),
    ])
    mockedRunWorkLoop.mockResolvedValue(workResult(ledger))
    mockedRunFinalizer.mockResolvedValue({
      ok: true,
      plan: validPlan({ eventSelections: [{ eventId: 'nope', sourceToolCallId: 's1' }] }),
    })

    const result = await orchestrate(baseInput)
    expect(result.canonical.provenance.fallbackUsed).toBe(true)
    expect(result.canonical.provenance.fallbackReason).toBe('unknown_event_id')
    expect(result.canonical.events.map((e) => e.id)).not.toContain('speed1')
    expect(result.canonical.events.map((e) => e.id)).toEqual(['tango'])
    expect(result.canonical.provenance.origin).toBe('fallback')
  })

  it('falls back on schema failure', async () => {
    const ledger = ledgerFrom([searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('a', 'A')], limit: 1 })])
    mockedRunWorkLoop.mockResolvedValue(workResult(ledger))
    mockedRunFinalizer.mockResolvedValue({ ok: false, error: 'invalid_schema' })

    const result = await orchestrate(baseInput)
    expect(result.canonical.provenance.fallbackUsed).toBe(true)
    expect(result.canonical.provenance.fallbackReason).toBe('invalid_schema')
    expect(result.canonical.text.length).toBeGreaterThan(0)
  })

  it('falls back with finalizer_error on a provider failure', async () => {
    const ledger = ledgerFrom([searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('a', 'A')], limit: 1 })])
    mockedRunWorkLoop.mockResolvedValue(workResult(ledger))
    mockedRunFinalizer.mockResolvedValue({ ok: false, error: 'finalizer_error' })

    const result = await orchestrate(baseInput)
    expect(result.canonical.provenance.fallbackUsed).toBe(true)
    expect(result.canonical.provenance.fallbackReason).toBe('finalizer_error')
  })

  it('preserves mutation receipts when finalization fails', async () => {
    const ledger = ledgerFrom([
      searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('a', 'A')], limit: 1 }),
      mutationEntry({ stepIndex: 1, callIndex: 0, toolCallId: 'm1', toolName: 'save_event', eventId: 'a', outcome: 'applied' }),
    ])
    mockedRunWorkLoop.mockResolvedValue(workResult(ledger))
    mockedRunFinalizer.mockResolvedValue({ ok: false, error: 'invalid_schema' })

    const result = await orchestrate(baseInput)
    expect(result.canonical.operations).toHaveLength(1)
    expect(result.canonical.kind).toBe('recommendations')
  })

  it('permits generic final text that names no event', async () => {
    const ledger = ledgerFrom([searchEntry({ stepIndex: 0, toolCallId: 's1', events: [event('tango', 'Tango night')], limit: 1 })])
    mockedRunWorkLoop.mockResolvedValue(workResult(ledger))
    mockedRunFinalizer.mockResolvedValue({
      ok: true,
      plan: validPlan({ text: 'Here you go.', eventSelections: [{ eventId: 'tango', sourceToolCallId: 's1' }] }),
    })

    const result = await orchestrate(baseInput)
    expect(result.canonical.text).toBe('Here you go.')
    expect(result.canonical.events.map((e) => e.id)).toEqual(['tango'])
    expect(result.canonical.provenance.fallbackUsed).toBe(false)
  })

  it('permits text mentioning the rejected speed-dating artifact while cards select tango', async () => {
    const ledger = ledgerFrom([
      searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('speed1', 'Speed dating')], limit: 1 }),
      searchEntry({ stepIndex: 1, toolCallId: 's1', events: [event('tango', 'Tango night')], limit: 1 }),
    ])
    mockedRunWorkLoop.mockResolvedValue(workResult(ledger))
    mockedRunFinalizer.mockResolvedValue({
      ok: true,
      plan: validPlan({
        text: 'Speed dating was unsuitable, so here is a tango night instead.',
        eventSelections: [{ eventId: 'tango', sourceToolCallId: 's1' }],
      }),
    })

    const result = await orchestrate(baseInput)
    expect(result.canonical.events.map((e) => e.id)).toEqual(['tango'])
    expect(result.canonical.text.toLowerCase()).toContain('speed dating')
    expect(result.canonical.provenance.fallbackUsed).toBe(false)
  })

  it('drives suggestions from the earlier selected search, not the later rejected one', async () => {
    const s0 = searchEntry({ stepIndex: 0, callIndex: 0, toolCallId: 's0', events: [event('tango', 'Tango night'), event('music', 'Live music')], limit: 2 })
    const s1 = searchEntry({ stepIndex: 1, callIndex: 0, toolCallId: 's1', events: [event('rejected', 'Rejected')], limit: 3 })
    s1.searchInput = { ...s1.searchInput, timeFilter: 'tonight' } as SearchEventsInput
    const ledger = ledgerFrom([s0, s1])
    mockedRunWorkLoop.mockResolvedValue(workResult(ledger))
    mockedRunFinalizer.mockResolvedValue({
      ok: true,
      plan: validPlan({
        eventSelections: [
          { eventId: 'tango', sourceToolCallId: 's0' },
          { eventId: 'music', sourceToolCallId: 's0' },
        ],
        suggestionSourceToolCallId: 's0',
      }),
    })

    const result = await orchestrate(baseInput)
    expect(result.canonical.events.map((e) => e.id)).toEqual(['tango', 'music'])
    // s0 has no timeFilter → a "tonight" refinement is produced; s1 (timeFilter
    // tonight) would NOT produce one, proving s0 drove suggestions.
    expect(result.canonical.suggestions.some((s) => s.id === 'tonight')).toBe(true)
  })

  it('derives coverage from the exact selected search provenance only', async () => {
    const s0 = searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('tango', 'Tango night')], limit: 1 })
    s0.coverage = { searchedTo: '2026-08-20', maxEventDate: '2026-08-30', totalMatches: 3, returned: 1 }
    const s1 = searchEntry({ stepIndex: 1, toolCallId: 's1', events: [event('other', 'Other')], limit: 1 })
    s1.coverage = { searchedTo: '2026-08-10', maxEventDate: '2026-08-11', totalMatches: 1, returned: 1 }
    const ledger = ledgerFrom([s0, s1])
    mockedRunWorkLoop.mockResolvedValue(workResult(ledger))
    mockedRunFinalizer.mockResolvedValue({
      ok: true,
      plan: validPlan({
        text: 'Go to tango.',
        eventSelections: [{ eventId: 'tango', sourceToolCallId: 's0' }],
        suggestionSourceToolCallId: 's0',
      }),
    })

    await orchestrate(baseInput)
    expect(mockedGuardCoverage).toHaveBeenCalledWith(expect.any(String), 'en', s0.coverage)
  })

  it('emits no suggestions when no selected search source exists', async () => {
    const ledger = ledgerFrom([
      searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('a', 'A')], limit: 1 }),
      mutationEntry({ stepIndex: 1, callIndex: 0, toolCallId: 'm1', toolName: 'save_event', eventId: 'a', outcome: 'applied' }),
    ])
    mockedRunWorkLoop.mockResolvedValue(workResult(ledger))
    mockedRunFinalizer.mockResolvedValue({ ok: false, error: 'invalid_schema' })

    const result = await orchestrate(baseInput)
    // Fallback recommendations derive suggestions from their selected search
    // provenance; assert the fallback still carries the mutation sibling.
    expect(result.canonical.operations).toHaveLength(1)
  })

  it('derives requestedCount from the final saved-events read when no search exists', async () => {
    const ledger = ledgerFrom([
      savedEventsEntry({
        stepIndex: 0,
        callIndex: 0,
        toolCallId: 'sv0',
        events: [event('a', 'A'), event('b', 'B'), event('c', 'C')],
      }),
    ])
    mockedRunWorkLoop.mockResolvedValue(workResult(ledger))
    mockedRunFinalizer.mockResolvedValue({
      ok: true,
      plan: validPlan({
        kind: 'saved_events',
        eventSelections: [
          { eventId: 'a', sourceToolCallId: 'sv0' },
          { eventId: 'b', sourceToolCallId: 'sv0' },
          { eventId: 'c', sourceToolCallId: 'sv0' },
        ],
      }),
    })

    await orchestrate(baseInput)
    expect(mockedRunFinalizer.mock.calls[0][0].requestedCount).toBe(3)
  })

  it('derives requestedCount from the final saved read over an earlier limit-1 search', async () => {
    const ledger = ledgerFrom([
      searchEntry({ stepIndex: 0, callIndex: 0, toolCallId: 's0', events: [event('x', 'X')], limit: 1 }),
      savedEventsEntry({
        stepIndex: 1,
        callIndex: 0,
        toolCallId: 'sv0',
        events: [event('a', 'A'), event('b', 'B'), event('c', 'C'), event('d', 'D'), event('e', 'E')],
      }),
    ])
    mockedRunWorkLoop.mockResolvedValue(workResult(ledger))
    mockedRunFinalizer.mockResolvedValue({
      ok: true,
      plan: validPlan({
        kind: 'saved_events',
        eventSelections: [
          { eventId: 'a', sourceToolCallId: 'sv0' },
          { eventId: 'b', sourceToolCallId: 'sv0' },
          { eventId: 'c', sourceToolCallId: 'sv0' },
          { eventId: 'd', sourceToolCallId: 'sv0' },
          { eventId: 'e', sourceToolCallId: 'sv0' },
        ],
      }),
    })

    await orchestrate(baseInput)
    expect(mockedRunFinalizer.mock.calls[0][0].requestedCount).toBe(5)
  })

  it('records fallback-derived suggestion provenance on the exact search artifact', async () => {
    const ledger = ledgerFrom([
      searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('a', 'A')], limit: 1 }),
    ])
    mockedRunWorkLoop.mockResolvedValue(workResult(ledger))
    mockedRunFinalizer.mockResolvedValue({ ok: false, error: 'invalid_schema' })

    const result = await orchestrate(baseInput)
    expect(result.canonical.provenance.fallbackUsed).toBe(true)
    expect(result.canonical.provenance.suggestionToolCallIds).toEqual(['s0'])
    expect(result.canonical.suggestions.length).toBeGreaterThan(0)
  })

  it('preserves mutation receipts when the off-topic classifier fires after a fallback mutation', async () => {
    const ledger = ledgerFrom([
      searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('a', 'A')], limit: 1 }),
      mutationEntry({ stepIndex: 1, callIndex: 0, toolCallId: 'm1', toolName: 'save_event', eventId: 'a', outcome: 'applied' }),
    ])
    mockedRunWorkLoop.mockResolvedValue(workResult(ledger))
    mockedRunFinalizer.mockResolvedValue({ ok: false, error: 'invalid_schema' })
    mockedGuardForOffTopic.mockResolvedValueOnce('off-topic refusal')

    const result = await orchestrate(baseInput)
    // The off-topic replacement is skipped because an operation was acknowledged.
    expect(result.canonical.kind).toBe('recommendations')
    expect(result.canonical.text).not.toBe('off-topic refusal')
    expect(result.canonical.operations).toHaveLength(1)
    expect(result.canonical.operations[0].eventId).toBe('a')
  })
})
