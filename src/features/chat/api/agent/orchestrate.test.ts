import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('./work-loop.ts', () => ({ runWorkLoop: vi.fn() }))
vi.mock('./finalizer.ts', () => ({ runFinalizer: vi.fn() }))

import { orchestrate } from './orchestrate.ts'
import { runWorkLoop } from './work-loop.ts'
import { runFinalizer } from './finalizer.ts'
import type { WorkLoopResult } from './work-loop.ts'
import { Ledger } from './ledger.ts'
import { searchEntry, savedEventsEntry, mutationEntry, retentionEntry, event, ledgerFrom } from './_test-helpers.ts'
import type { FinalizerPlan } from './finalizer.ts'
import type { SearchEventsInput } from '../tools/search-events.ts'

const mockedRunWorkLoop = vi.mocked(runWorkLoop)
const mockedRunFinalizer = vi.mocked(runFinalizer)

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
    contractVersion: 4,
    primaryKind: 'recommendations',
    messageKey: 'recommendations',
    eventSelections: [{ eventId: 'tango', sourceToolCallId: 's1' }],
    directionsToolCallId: null,
    venueToolCallId: null,
    suggestionSourceToolCallId: null,
    operationToolCallIds: [],
    emptySourceToolCallIds: [],
    clarificationQuestions: [],
    reason: null,
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

describe('orchestrate (v4)', () => {
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
      plan: validPlan({ eventSelections: [{ eventId: 'tango', sourceToolCallId: 's2' }] }),
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

  it('materializes text deterministically from the closed messageKey — no model prose', async () => {
    const ledger = ledgerFrom([searchEntry({ stepIndex: 0, toolCallId: 's1', events: [event('tango', 'Tango night')], limit: 1 })])
    mockedRunWorkLoop.mockResolvedValue(workResult(ledger))
    mockedRunFinalizer.mockResolvedValue({
      ok: true,
      plan: validPlan({ eventSelections: [{ eventId: 'tango', sourceToolCallId: 's1' }] }),
    })

    const result = await orchestrate(baseInput)
    // The finalizer plan carries no text field; the server writes the template.
    expect(result.canonical.text).toBe('Here are the best matches I found.')
    expect(result.canonical.messageKey).toBe('recommendations')
    expect(result.canonical.text).not.toContain('Tango night')
  })

  it('materializes a clarification as one text block containing the question labels (EN)', async () => {
    mockedRunWorkLoop.mockResolvedValue(workResult(ledgerFrom([])))
    mockedRunFinalizer.mockResolvedValue({
      ok: true,
      plan: validPlan({
        primaryKind: 'clarification',
        messageKey: 'clarification',
        eventSelections: [],
        clarificationQuestions: [{ key: 'which_day' }],
      }),
    })

    const result = await orchestrate(baseInput)
    expect(result.canonical.kind).toBe('clarification')
    expect(result.canonical.text).toBe('Which day are you interested in?')
    expect(result.canonical.text).toContain('?')
    expect(result.canonical.clarificationQuestions).toEqual([
      { key: 'which_day', label: 'Which day are you interested in?' },
    ])
  })

  it('materializes a clarification as one text block with the default question (ES)', async () => {
    mockedRunWorkLoop.mockResolvedValue(workResult(ledgerFrom([])))
    mockedRunFinalizer.mockResolvedValue({
      ok: true,
      plan: validPlan({
        primaryKind: 'clarification',
        messageKey: 'clarification',
        eventSelections: [],
        clarificationQuestions: [],
      }),
    })

    const result = await orchestrate({ ...baseInput, locale: 'es' })
    expect(result.canonical.kind).toBe('clarification')
    expect(result.canonical.text).toBe('¿Qué tipo de evento buscás?')
    expect(result.canonical.text).toContain('?')
    expect(result.canonical.clarificationQuestions).toEqual([
      { key: 'which_category', label: '¿Qué tipo de evento buscás?' },
    ])
  })

  it('materializes share_guidance text under the out_of_scope kind', async () => {
    mockedRunWorkLoop.mockResolvedValue(workResult(ledgerFrom([])))
    mockedRunFinalizer.mockResolvedValue({
      ok: true,
      plan: validPlan({
        primaryKind: 'out_of_scope',
        messageKey: 'share_guidance',
        eventSelections: [],
      }),
    })

    const result = await orchestrate(baseInput)
    expect(result.canonical.kind).toBe('out_of_scope')
    expect(result.canonical.messageKey).toBe('share_guidance')
    expect(result.canonical.text).toContain('share button')
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

  it('falls back to a localized error with zero cards and exact provenance after a provider failure on a failed refinement', async () => {
    const ledger = ledgerFrom([
      searchEntry({ stepIndex: 0, callIndex: 0, toolCallId: 's0', events: [event('speed1', 'Speed dating')], limit: 1 }),
      searchEntry({ stepIndex: 1, callIndex: 0, toolCallId: 's1', events: [], limit: 3, success: false }),
    ])
    mockedRunWorkLoop.mockResolvedValue(workResult(ledger))
    mockedRunFinalizer.mockResolvedValue({ ok: false, error: 'finalizer_error' })

    const result = await orchestrate(baseInput)

    expect(result.canonical.provenance.fallbackUsed).toBe(true)
    expect(result.canonical.provenance.fallbackReason).toBe('finalizer_error')
    expect(result.canonical.kind).toBe('error')
    expect(result.canonical.events).toEqual([])
    // The earlier successful speed-dating card is never resurrected.
    expect(result.canonical.events.map((e) => e.id)).not.toContain('speed1')
    expect(result.canonical.text).toBe('Something went wrong. Please try again.')
    // Exact provenance: the failed latest stage is the active attempt.
    expect(result.canonical.provenance.searchAttemptToolCallIds).toEqual(['s1'])
    expect(result.canonical.provenance.stageIds).toEqual(['stage-1'])
  })

  it('falls back to a localized error with zero cards after a schema failure on a failed refinement', async () => {
    const ledger = ledgerFrom([
      searchEntry({ stepIndex: 0, callIndex: 0, toolCallId: 's0', events: [event('speed1', 'Speed dating')], limit: 1 }),
      searchEntry({ stepIndex: 1, callIndex: 0, toolCallId: 's1', events: [], limit: 3, success: false }),
    ])
    mockedRunWorkLoop.mockResolvedValue(workResult(ledger))
    mockedRunFinalizer.mockResolvedValue({ ok: false, error: 'invalid_schema' })

    const result = await orchestrate(baseInput)

    expect(result.canonical.provenance.fallbackUsed).toBe(true)
    expect(result.canonical.provenance.fallbackReason).toBe('invalid_schema')
    expect(result.canonical.kind).toBe('error')
    expect(result.canonical.events).toEqual([])
    expect(result.canonical.events.map((e) => e.id)).not.toContain('speed1')
    expect(result.canonical.text.length).toBeGreaterThan(0)
    expect(result.canonical.provenance.searchAttemptToolCallIds).toEqual(['s1'])
    expect(result.canonical.provenance.stageIds).toEqual(['stage-1'])
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

  it('drives suggestions from the earlier selected search, not the later rejected one', async () => {
    const s0 = searchEntry({ stepIndex: 0, callIndex: 0, toolCallId: 's0', events: [event('tango', 'Tango night'), event('music', 'Live music')], limit: 2 })
    const s1 = searchEntry({ stepIndex: 1, callIndex: 0, toolCallId: 's1', events: [event('rejected', 'Rejected')], limit: 3 })
    s1.searchInput = { ...s1.searchInput, timeFilter: 'tonight' } as SearchEventsInput
    const ret = retentionEntry({ toolCallId: 'r0', retainedToolCallIds: ['s0'], stepIndex: 1, callIndex: 1 })
    const ledger = ledgerFrom([s0, s1, ret])
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
    expect(result.canonical.suggestions.some((s) => s.id === 'tonight')).toBe(true)
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
        primaryKind: 'saved_events',
        messageKey: 'saved_events',
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
        primaryKind: 'saved_events',
        messageKey: 'saved_events',
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
    const ledger = ledgerFrom([searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('a', 'A')], limit: 1 })])
    mockedRunWorkLoop.mockResolvedValue(workResult(ledger))
    mockedRunFinalizer.mockResolvedValue({ ok: false, error: 'invalid_schema' })

    const result = await orchestrate(baseInput)
    expect(result.canonical.provenance.fallbackUsed).toBe(true)
    expect(result.canonical.provenance.suggestionToolCallIds).toEqual(['s0'])
    expect(result.canonical.suggestions.length).toBeGreaterThan(0)
  })

  it('plumbs pinnedEventId through to the work loop (restricts broad discovery)', async () => {
    const ledger = ledgerFrom([eventDetailsEntryLike()])
    mockedRunWorkLoop.mockResolvedValue(workResult(ledger))
    mockedRunFinalizer.mockResolvedValue({
      ok: true,
      plan: validPlan({
        primaryKind: 'event_details',
        messageKey: 'event_details',
        eventSelections: [{ eventId: 'pin', sourceToolCallId: 'd0' }],
      }),
    })

    await orchestrate({ ...baseInput, pinnedEventId: 'pin' })
    expect(mockedRunWorkLoop.mock.calls[0][0].pinnedEventId).toBe('pin')
  })
})

// A minimal pinned details ledger entry for the pinned-plumbing test.
function eventDetailsEntryLike() {
  return searchEntry({ stepIndex: 0, toolCallId: 'd0', events: [event('pin', 'Pinned')], limit: 1 })
}
