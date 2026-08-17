import { describe, expect, it } from 'vitest'
import { validatePlan } from './validate.ts'
import { ledgerFrom, searchEntry, mutationEntry, directionsEntry, event } from './_test-helpers.ts'
import type { FinalizerPlan } from './finalizer.ts'
import type { LedgerEntry } from './ledger.ts'

function plan(overrides: Partial<FinalizerPlan>): FinalizerPlan {
  return {
    contractVersion: 3,
    kind: 'recommendations',
    text: 'Go to this one.',
    eventSelections: [],
    directionsToolCallId: null,
    venueToolCallId: null,
    suggestionSourceToolCallId: null,
    operationToolCallIds: [],
    ...overrides,
  }
}

const REQ = 'req-1'

describe('validatePlan', () => {
  const search = searchEntry({
    stepIndex: 0,
    toolCallId: 'call-search',
    events: [event('e1', 'Tango night'), event('e2', 'Jazz set')],
    limit: 3,
  })

  it('accepts a valid single selection bound to its source artifact', () => {
    const result = validatePlan(
      plan({
        kind: 'recommendations',
        eventSelections: [{ eventId: 'e1', sourceToolCallId: 'call-search' }],
      }),
      ledgerFrom([search]),
      { requestId: REQ, requestedCount: 3 }
    )
    expect(result.ok).toBe(true)
    expect(result.events.map((e) => e.id)).toEqual(['e1'])
    expect(result.sourceToolCallIds).toEqual(['call-search'])
  })

  it('dedupes provenance when several selected events share one source call', () => {
    const result = validatePlan(
      plan({
        eventSelections: [
          { eventId: 'e1', sourceToolCallId: 'call-search' },
          { eventId: 'e2', sourceToolCallId: 'call-search' },
        ],
      }),
      ledgerFrom([search]),
      { requestId: REQ, requestedCount: 3 }
    )
    expect(result.ok).toBe(true)
    expect(result.sourceToolCallIds).toEqual(['call-search'])
  })

  it('rejects an unknown event id', () => {
    const result = validatePlan(
      plan({ eventSelections: [{ eventId: 'nope', sourceToolCallId: 'call-search' }] }),
      ledgerFrom([search]),
      { requestId: REQ, requestedCount: 3 }
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('unknown_event_id')
  })

  it('rejects a wrong source tool call id', () => {
    const result = validatePlan(
      plan({ eventSelections: [{ eventId: 'e1', sourceToolCallId: 'call-missing' }] }),
      ledgerFrom([search]),
      { requestId: REQ, requestedCount: 3 }
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('invalid_source_tool_call')
  })

  it('rejects a source from a different request', () => {
    const foreign = searchEntry({ toolCallId: 'call-foreign', events: [event('e1', 'Tango night')] })
    foreign.requestId = 'other-request'
    const result = validatePlan(
      plan({ eventSelections: [{ eventId: 'e1', sourceToolCallId: 'call-foreign' }] }),
      ledgerFrom([foreign]),
      { requestId: REQ, requestedCount: 3 }
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('invalid_source_tool_call')
  })

  it('rejects empty text', () => {
    const result = validatePlan(
      plan({ text: '   ', eventSelections: [] }),
      ledgerFrom([search]),
      { requestId: REQ, requestedCount: 3 }
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('empty_text')
  })

  it('rejects duplicate event ids', () => {
    const result = validatePlan(
      plan({
        kind: 'recommendations',
        eventSelections: [
          { eventId: 'e1', sourceToolCallId: 'call-search' },
          { eventId: 'e1', sourceToolCallId: 'call-search' },
        ],
      }),
      ledgerFrom([search]),
      { requestId: REQ, requestedCount: 3 }
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('duplicate_event_id')
  })

  it('rejects selections over the requested count', () => {
    const result = validatePlan(
      plan({
        kind: 'recommendations',
        eventSelections: [
          { eventId: 'e1', sourceToolCallId: 'call-search' },
          { eventId: 'e2', sourceToolCallId: 'call-search' },
        ],
      }),
      ledgerFrom([search]),
      { requestId: REQ, requestedCount: 1 }
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('over_limit')
  })

  it('rejects a kind that expects events but selected none', () => {
    const result = validatePlan(
      plan({ kind: 'recommendations', eventSelections: [] }),
      ledgerFrom([search]),
      { requestId: REQ, requestedCount: 3 }
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('missing_required_artifact')
  })

  it('rejects event_details with two selections', () => {
    const result = validatePlan(
      plan({
        kind: 'event_details',
        eventSelections: [
          { eventId: 'e1', sourceToolCallId: 'call-search' },
          { eventId: 'e2', sourceToolCallId: 'call-search' },
        ],
      }),
      ledgerFrom([search]),
      { requestId: REQ, requestedCount: 3 }
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('inconsistent_response_kind')
  })

  it('rejects a saved_events selection sourced from a search artifact', () => {
    const result = validatePlan(
      plan({
        kind: 'saved_events',
        eventSelections: [{ eventId: 'e1', sourceToolCallId: 'call-search' }],
      }),
      ledgerFrom([search]),
      { requestId: REQ, requestedCount: 3 }
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('inconsistent_response_kind')
  })

  it('rejects substituting the pinned event', () => {
    const details: LedgerEntry = {
      ...searchEntry({ toolCallId: 'call-details', events: [event('e1', 'Tango night')] }),
      kind: 'event-details',
      toolName: 'get_event_details',
    }
    const result = validatePlan(
      plan({
        kind: 'recommendations',
        eventSelections: [{ eventId: 'e2', sourceToolCallId: 'call-search' }],
      }),
      ledgerFrom([search, details]),
      { requestId: REQ, requestedCount: 3, pinnedEventId: 'e1' }
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('pinned_substitution')
  })

  it('accepts the pinned event when selected', () => {
    const details: LedgerEntry = {
      ...searchEntry({ toolCallId: 'call-details', events: [event('e1', 'Tango night')] }),
      kind: 'event-details',
      toolName: 'get_event_details',
    }
    const result = validatePlan(
      plan({
        kind: 'recommendations',
        eventSelections: [{ eventId: 'e1', sourceToolCallId: 'call-search' }],
      }),
      ledgerFrom([search, details]),
      { requestId: REQ, requestedCount: 3, pinnedEventId: 'e1' }
    )
    expect(result.ok).toBe(true)
  })

  it('rejects an invalid mutation reference', () => {
    const result = validatePlan(
      plan({ kind: 'mutation_result', operationToolCallIds: ['call-missing'] }),
      ledgerFrom([search]),
      { requestId: REQ, requestedCount: 3 }
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('invalid_mutation_ref')
  })

  it('rejects a mutation reference from a different request', () => {
    const m1 = mutationEntry({ toolCallId: 'call-save', toolName: 'save_event', eventId: 'e1', outcome: 'applied' })
    m1.requestId = 'other-request'
    const result = validatePlan(
      plan({ kind: 'mutation_result', operationToolCallIds: ['call-save'] }),
      ledgerFrom([m1]),
      { requestId: REQ, requestedCount: 3 }
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('invalid_mutation_ref')
  })

  it('accepts failed and unauthenticated mutation receipts as valid', () => {
    const failed = mutationEntry({ toolCallId: 'call-failed', toolName: 'save_event', eventId: 'e1', outcome: 'failed' })
    const unauth = mutationEntry({ toolCallId: 'call-unauth', toolName: 'save_event', eventId: 'e2', outcome: 'unauthenticated' })
    const result = validatePlan(
      plan({ kind: 'mutation_result', operationToolCallIds: ['call-failed', 'call-unauth'] }),
      ledgerFrom([failed, unauth]),
      { requestId: REQ, requestedCount: 3 }
    )
    expect(result.ok).toBe(true)
    expect(result.operations.map((o) => o.outcome)).toEqual(['failed', 'unauthenticated'])
  })

  it('materializes every deduped mutation receipt, never duplicates', () => {
    const m1 = mutationEntry({ toolCallId: 'call-save', toolName: 'save_event', eventId: 'e1', outcome: 'applied' })
    const m2 = mutationEntry({ toolCallId: 'call-save-dup', toolName: 'save_event', eventId: 'e1', outcome: 'applied' })
    const m3 = mutationEntry({ toolCallId: 'call-unsave', toolName: 'unsave_event', eventId: 'e2', outcome: 'applied' })
    const result = validatePlan(
      plan({
        kind: 'mutation_result',
        eventSelections: [],
        operationToolCallIds: ['call-save'],
      }),
      ledgerFrom([search, m1, m2, m3]),
      { requestId: REQ, requestedCount: 3 }
    )
    expect(result.ok).toBe(true)
    // save(e1) collapsed to one, unsave(e2) retained → exactly two operations.
    expect(result.operations.map((o) => o.eventId)).toEqual(['e1', 'e2'])
    expect(result.mutationToolCallIds).toEqual(['call-save', 'call-unsave'])
  })

  it('rejects an invalid directions reference', () => {
    const result = validatePlan(
      plan({ kind: 'directions', directionsToolCallId: 'call-missing' }),
      ledgerFrom([search]),
      { requestId: REQ, requestedCount: 3 }
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('invalid_directions_ref')
  })

  it('rejects a directions kind with no direction reference', () => {
    const result = validatePlan(
      plan({ kind: 'directions', directionsToolCallId: null }),
      ledgerFrom([search]),
      { requestId: REQ, requestedCount: 3 }
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('missing_required_artifact')
  })

  it('accepts a valid directions reference', () => {
    const dir = directionsEntry({ toolCallId: 'call-dir', venueName: 'Niceto' })
    const result = validatePlan(
      plan({ kind: 'directions', directionsToolCallId: 'call-dir' }),
      ledgerFrom([dir]),
      { requestId: REQ, requestedCount: 3 }
    )
    expect(result.ok).toBe(true)
    expect(result.directions?.venueName).toBe('Niceto')
    expect(result.directionToolCallIds).toEqual(['call-dir'])
  })

  it('rejects a venue_details kind with no venue reference', () => {
    const result = validatePlan(
      plan({ kind: 'venue_details', venueToolCallId: null }),
      ledgerFrom([search]),
      { requestId: REQ, requestedCount: 3 }
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('missing_required_artifact')
  })

  it('rejects a clarification kind carrying events', () => {
    const result = validatePlan(
      plan({
        kind: 'clarification',
        eventSelections: [{ eventId: 'e1', sourceToolCallId: 'call-search' }],
      }),
      ledgerFrom([search]),
      { requestId: REQ, requestedCount: 3 }
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('inconsistent_response_kind')
  })

  it('validates a relevant suggestion source and returns it', () => {
    const result = validatePlan(
      plan({
        kind: 'recommendations',
        eventSelections: [{ eventId: 'e1', sourceToolCallId: 'call-search' }],
        suggestionSourceToolCallId: 'call-search',
      }),
      ledgerFrom([search]),
      { requestId: REQ, requestedCount: 3 }
    )
    expect(result.ok).toBe(true)
    expect(result.suggestionSourceToolCallId).toBe('call-search')
    expect(result.suggestionToolCallIds).toEqual(['call-search'])
  })

  it('rejects a suggestion source that is not a search artifact', () => {
    const result = validatePlan(
      plan({ suggestionSourceToolCallId: 'call-missing' }),
      ledgerFrom([search]),
      { requestId: REQ, requestedCount: 3 }
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('invalid_source_tool_call')
  })

  it('rejects an irrelevant suggestion source that is a valid but unrelated search', () => {
    const other = searchEntry({ stepIndex: 1, toolCallId: 'call-other', events: [event('e3', 'Other')], limit: 3 })
    const result = validatePlan(
      plan({
        eventSelections: [{ eventId: 'e1', sourceToolCallId: 'call-search' }],
        suggestionSourceToolCallId: 'call-other',
      }),
      ledgerFrom([search, other]),
      { requestId: REQ, requestedCount: 3 }
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('invalid_source_tool_call')
  })

  it('selects the exact requested event id when two events share a name', () => {
    const shared = searchEntry({
      stepIndex: 0,
      toolCallId: 'call-search',
      events: [event('e1', 'Tango night'), event('e2', 'Tango night')],
      limit: 3,
    })
    const result = validatePlan(
      plan({ eventSelections: [{ eventId: 'e2', sourceToolCallId: 'call-search' }] }),
      ledgerFrom([shared]),
      { requestId: REQ, requestedCount: 3 }
    )
    expect(result.ok).toBe(true)
    expect(result.events.map((e) => e.id)).toEqual(['e2'])
  })
})
