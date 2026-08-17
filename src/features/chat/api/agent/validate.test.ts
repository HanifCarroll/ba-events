import { describe, expect, it } from 'vitest'
import { validatePlan, type ValidateOptions } from './validate.ts'
import {
  ledgerFrom,
  searchEntry,
  mutationEntry,
  directionsEntry,
  eventDetailsEntry,
  savedEventsEntry,
  venueDetailsEntry,
  checkSavedEntry,
  retentionEntry,
  rejectionEntry,
  event,
} from './_test-helpers.ts'
import type { FinalizerPlan } from './finalizer.ts'
import type { LedgerEntry } from './ledger.ts'

function plan(overrides: Partial<FinalizerPlan> = {}): FinalizerPlan {
  return {
    contractVersion: 4,
    primaryKind: 'recommendations',
    messageKey: 'recommendations',
    eventSelections: [],
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

const REQ = 'req-1'

function v(planInput: FinalizerPlan, entries: LedgerEntry[], opts: Partial<ValidateOptions> = {}) {
  return validatePlan(planInput, ledgerFrom(entries), {
    requestId: REQ,
    locale: 'en',
    requestedCount: 3,
    ...opts,
  })
}

describe('validatePlan (v4)', () => {
  const search = searchEntry({
    stepIndex: 0,
    toolCallId: 'call-search',
    events: [event('e1', 'Tango night'), event('e2', 'Jazz set')],
    limit: 3,
  })

  it('accepts a valid single selection bound to its source artifact', () => {
    const result = v(
      plan({ eventSelections: [{ eventId: 'e1', sourceToolCallId: 'call-search' }] }),
      [search]
    )
    expect(result.ok).toBe(true)
    expect(result.events.map((e) => e.id)).toEqual(['e1'])
    expect(result.sourceToolCallIds).toEqual(['call-search'])
  })

  it('dedupes provenance when several selected events share one source call', () => {
    const result = v(
      plan({
        eventSelections: [
          { eventId: 'e1', sourceToolCallId: 'call-search' },
          { eventId: 'e2', sourceToolCallId: 'call-search' },
        ],
      }),
      [search]
    )
    expect(result.ok).toBe(true)
    expect(result.sourceToolCallIds).toEqual(['call-search'])
  })

  it('rejects an unknown event id', () => {
    const result = v(plan({ eventSelections: [{ eventId: 'nope', sourceToolCallId: 'call-search' }] }), [search])
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('unknown_event_id')
  })

  it('rejects a wrong source tool call id', () => {
    const result = v(plan({ eventSelections: [{ eventId: 'e1', sourceToolCallId: 'call-missing' }] }), [search])
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('invalid_source_tool_call')
  })

  it('rejects a source from a different request', () => {
    const foreign = searchEntry({ toolCallId: 'call-foreign', events: [event('e1', 'Tango night')] })
    foreign.requestId = 'other-request'
    const result = v(plan({ eventSelections: [{ eventId: 'e1', sourceToolCallId: 'call-foreign' }] }), [foreign])
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('invalid_source_tool_call')
  })

  it('rejects duplicate event ids', () => {
    const result = v(
      plan({
        eventSelections: [
          { eventId: 'e1', sourceToolCallId: 'call-search' },
          { eventId: 'e1', sourceToolCallId: 'call-search' },
        ],
      }),
      [search]
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('duplicate_event_id')
  })

  it('rejects selections over the requested count', () => {
    const result = v(
      plan({
        eventSelections: [
          { eventId: 'e1', sourceToolCallId: 'call-search' },
          { eventId: 'e2', sourceToolCallId: 'call-search' },
        ],
      }),
      [search],
      { requestedCount: 1 }
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('over_limit')
  })

  it('rejects a kind that expects events but selected none', () => {
    const result = v(plan({ eventSelections: [] }), [search])
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('missing_required_artifact')
  })

  it('rejects event_details with two selections', () => {
    const result = v(
      plan({
        primaryKind: 'event_details',
        messageKey: 'event_details',
        eventSelections: [
          { eventId: 'e1', sourceToolCallId: 'call-search' },
          { eventId: 'e2', sourceToolCallId: 'call-search' },
        ],
      }),
      [search]
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('inconsistent_response_kind')
  })

  it('rejects a saved_events selection sourced from a search artifact', () => {
    const result = v(
      plan({
        primaryKind: 'saved_events',
        messageKey: 'saved_events',
        eventSelections: [{ eventId: 'e1', sourceToolCallId: 'call-search' }],
      }),
      [search]
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('inconsistent_response_kind')
  })

  it('rejects an invalid messageKey for the primary kind', () => {
    const result = v(plan({ primaryKind: 'event_details', messageKey: 'recommendations' }), [search])
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('invalid_message_key')
  })

  it('rejects a superseded (non-retained) search source', () => {
    const s0 = searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('old', 'Old')], limit: 3 })
    const s1 = searchEntry({ stepIndex: 1, toolCallId: 's1', events: [event('now', 'Now')], limit: 3 })
    const result = v(plan({ eventSelections: [{ eventId: 'old', sourceToolCallId: 's0' }] }), [s0, s1])
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('superseded_source')
  })

  it('accepts an explicitly retained earlier search source', () => {
    const s0 = searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('old', 'Old')], limit: 3 })
    const s1 = searchEntry({ stepIndex: 1, toolCallId: 's1', events: [], limit: 3 })
    const ret = retentionEntry({ toolCallId: 'r0', retainedToolCallIds: ['s0'], stepIndex: 1, callIndex: 1 })
    const result = v(plan({ eventSelections: [{ eventId: 'old', sourceToolCallId: 's0' }] }), [s0, s1, ret])
    expect(result.ok).toBe(true)
    expect(result.events.map((e) => e.id)).toEqual(['old'])
    expect(result.retainedSourceToolCallIds).toEqual(['s0'])
  })

  it('records the stage id of the contributing search source', () => {
    const s1 = searchEntry({ stepIndex: 1, toolCallId: 's1', events: [event('a', 'A')], limit: 3 })
    const result = v(plan({ eventSelections: [{ eventId: 'a', sourceToolCallId: 's1' }] }), [s1])
    expect(result.ok).toBe(true)
    expect(result.stageIds).toEqual(['stage-1'])
  })

  describe('pinned enforcement', () => {
    it('accepts the pinned event from its details', () => {
      const details = eventDetailsEntry({ toolCallId: 'd0', eventId: 'pin', name: 'Pinned' })
      const result = v(
        plan({
          primaryKind: 'event_details',
          messageKey: 'event_details',
          eventSelections: [{ eventId: 'pin', sourceToolCallId: 'd0' }],
        }),
        [details],
        { pinnedEventId: 'pin' }
      )
      expect(result.ok).toBe(true)
      expect(result.events.map((e) => e.id)).toEqual(['pin'])
    })

    it('rejects substituting the pinned event with a search result', () => {
      const details = eventDetailsEntry({ toolCallId: 'd0', eventId: 'pin', name: 'Pinned' })
      const s0 = searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('other', 'Other')], limit: 1 })
      const result = v(
        plan({ eventSelections: [{ eventId: 'other', sourceToolCallId: 's0' }] }),
        [details, s0],
        { pinnedEventId: 'pin' }
      )
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('pinned_substitution')
    })

    it('rejects the pinned event sourced from a search (not details)', () => {
      const s0 = searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('pin', 'Pinned')], limit: 1 })
      const result = v(
        plan({ eventSelections: [{ eventId: 'pin', sourceToolCallId: 's0' }] }),
        [s0],
        { pinnedEventId: 'pin' }
      )
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('pinned_substitution')
    })

    it('allows directions to the pinned event without substituting', () => {
      const details = eventDetailsEntry({ toolCallId: 'd0', eventId: 'pin', name: 'Pinned', venueId: 'v1' })
      const dir = directionsEntry({ toolCallId: 'dir0', eventId: 'pin' })
      const result = v(
        plan({ primaryKind: 'directions', messageKey: 'directions', directionsToolCallId: 'dir0', eventSelections: [] }),
        [details, dir],
        { pinnedEventId: 'pin' }
      )
      expect(result.ok).toBe(true)
      expect(result.directions?.eventId).toBe('pin')
    })
  })

  describe('compound siblings', () => {
    const search = searchEntry({
      stepIndex: 0,
      toolCallId: 's0',
      events: [event('e1', 'Tango', { venue_id: 'v1' })],
      limit: 1,
    })

    it('accepts events + related directions + related venue + mutation', () => {
      const dir = directionsEntry({ toolCallId: 'dir0', eventId: 'e1' })
      const venue = venueDetailsEntry({ toolCallId: 'v0', venueId: 'v1' })
      const mutation = mutationEntry({ toolCallId: 'm0', toolName: 'save_event', eventId: 'e1', outcome: 'applied' })
      const result = v(
        plan({
          eventSelections: [{ eventId: 'e1', sourceToolCallId: 's0' }],
          directionsToolCallId: 'dir0',
          venueToolCallId: 'v0',
          operationToolCallIds: ['m0'],
        }),
        [search, dir, venue, mutation]
      )
      expect(result.ok).toBe(true)
      expect(result.events.map((e) => e.id)).toEqual(['e1'])
      expect(result.directions?.eventId).toBe('e1')
      expect(result.venue?.venueId).toBe('v1')
      expect(result.operations).toHaveLength(1)
    })

    it('rejects an unrelated directions ref', () => {
      const dir = directionsEntry({ toolCallId: 'dir0', eventId: 'other' })
      const result = v(
        plan({
          eventSelections: [{ eventId: 'e1', sourceToolCallId: 's0' }],
          directionsToolCallId: 'dir0',
        }),
        [search, dir]
      )
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('unrelated_directions_ref')
    })

    it('rejects an unrelated venue ref', () => {
      const venue = venueDetailsEntry({ toolCallId: 'v0', venueId: 'v-other' })
      const result = v(
        plan({
          eventSelections: [{ eventId: 'e1', sourceToolCallId: 's0' }],
          venueToolCallId: 'v0',
        }),
        [search, venue]
      )
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('unrelated_venue_ref')
    })

    it('accepts a directions ref that relates via an explicit resolved event id', () => {
      const dir = directionsEntry({ toolCallId: 'dir0', eventId: 'resolved' })
      const result = v(
        plan({ primaryKind: 'directions', messageKey: 'directions', directionsToolCallId: 'dir0' }),
        [dir],
        { resolvedEventId: 'resolved' }
      )
      expect(result.ok).toBe(true)
    })

    it('accepts a saved list plus directions to the selected first event', () => {
      const saved = savedEventsEntry({ toolCallId: 'sv0', events: [event('e1', 'Saved A'), event('e2', 'Saved B')] })
      const dir = directionsEntry({ toolCallId: 'dir0', eventId: 'e1' })
      const result = v(
        plan({
          primaryKind: 'saved_events',
          messageKey: 'saved_events',
          eventSelections: [
            { eventId: 'e1', sourceToolCallId: 'sv0' },
            { eventId: 'e2', sourceToolCallId: 'sv0' },
          ],
          directionsToolCallId: 'dir0',
        }),
        [saved, dir]
      )
      expect(result.ok).toBe(true)
      expect(result.kind).toBe('saved_events')
      expect(result.directions?.eventId).toBe('e1')
      expect(result.events[0].saved).toBe(true)
    })

    it('accepts event details plus directions to that event', () => {
      const details = eventDetailsEntry({ toolCallId: 'd0', eventId: 'e1', name: 'Tango' })
      const dir = directionsEntry({ toolCallId: 'dir0', eventId: 'e1' })
      const result = v(
        plan({
          primaryKind: 'event_details',
          messageKey: 'event_details',
          eventSelections: [{ eventId: 'e1', sourceToolCallId: 'd0' }],
          directionsToolCallId: 'dir0',
        }),
        [details, dir]
      )
      expect(result.ok).toBe(true)
      expect(result.kind).toBe('event_details')
      expect(result.directions?.eventId).toBe('e1')
    })
  })

  describe('no_results grounding', () => {
    it('accepts no_results with a successful empty active search stage', () => {
      const empty = searchEntry({ stepIndex: 0, toolCallId: 's0', events: [], limit: 1 })
      const result = v(
        plan({ primaryKind: 'no_results', messageKey: 'no_results', emptySourceToolCallIds: ['s0'] }),
        [empty]
      )
      expect(result.ok).toBe(true)
      expect(result.emptySourceToolCallIds).toEqual(['s0'])
    })

    it('rejects no_results with no empty source', () => {
      const result = v(plan({ primaryKind: 'no_results', messageKey: 'no_results' }), [])
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('invalid_empty_source')
    })

    it('rejects no_results grounded only on a failed search', () => {
      const failed = searchEntry({ stepIndex: 0, toolCallId: 's0', events: [], limit: 1, success: false })
      const result = v(
        plan({ primaryKind: 'no_results', messageKey: 'no_results', emptySourceToolCallIds: ['s0'] }),
        [failed]
      )
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('invalid_empty_source')
    })

    it('rejects no_results when the active stage has events', () => {
      const nonEmpty = searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('a', 'A')], limit: 1 })
      const result = v(
        plan({ primaryKind: 'no_results', messageKey: 'no_results', emptySourceToolCallIds: ['s0'] }),
        [nonEmpty]
      )
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('no_results')
    })

    it('accepts no_results grounded on an empty saved-events read', () => {
      const saved = savedEventsEntry({ toolCallId: 'sv0', events: [] })
      const result = v(
        plan({ primaryKind: 'no_results', messageKey: 'no_results', emptySourceToolCallIds: ['sv0'] }),
        [saved]
      )
      expect(result.ok).toBe(true)
    })
  })

  describe('mutation receipts', () => {
    it('rejects an invalid mutation reference', () => {
      const result = v(
        plan({ primaryKind: 'mutation_result', messageKey: 'mutation_result', operationToolCallIds: ['call-missing'] }),
        [search]
      )
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('invalid_mutation_ref')
    })

    it('accepts failed and unauthenticated mutation receipts as valid', () => {
      const failed = mutationEntry({ toolCallId: 'call-failed', toolName: 'save_event', eventId: 'e1', outcome: 'failed' })
      const unauth = mutationEntry({ toolCallId: 'call-unauth', toolName: 'save_event', eventId: 'e2', outcome: 'unauthenticated' })
      const result = v(
        plan({ primaryKind: 'mutation_result', messageKey: 'mutation_result', operationToolCallIds: ['call-failed', 'call-unauth'] }),
        [failed, unauth]
      )
      expect(result.ok).toBe(true)
      expect(result.operations.map((o) => o.outcome)).toEqual(['failed', 'unauthenticated'])
    })

    it('materializes every deduped mutation receipt, never duplicates', () => {
      const m1 = mutationEntry({ toolCallId: 'call-save', toolName: 'save_event', eventId: 'e1', outcome: 'applied' })
      const m2 = mutationEntry({ toolCallId: 'call-save-dup', toolName: 'save_event', eventId: 'e1', outcome: 'applied' })
      const m3 = mutationEntry({ toolCallId: 'call-unsave', toolName: 'unsave_event', eventId: 'e2', outcome: 'applied' })
      const result = v(
        plan({ primaryKind: 'mutation_result', messageKey: 'mutation_result', operationToolCallIds: ['call-save'] }),
        [m1, m2, m3]
      )
      expect(result.ok).toBe(true)
      expect(result.operations.map((o) => o.eventId)).toEqual(['e1', 'e2'])
      expect(result.mutationToolCallIds).toEqual(['call-save', 'call-unsave'])
    })
  })

  describe('directions / venue refs', () => {
    it('rejects an invalid directions reference', () => {
      const result = v(
        plan({ primaryKind: 'directions', messageKey: 'directions', directionsToolCallId: 'call-missing' }),
        [search]
      )
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('invalid_directions_ref')
    })

    it('rejects a directions kind with no direction reference', () => {
      const result = v(plan({ primaryKind: 'directions', messageKey: 'directions' }), [search])
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('missing_required_artifact')
    })

    it('rejects a venue_details kind with no venue reference', () => {
      const result = v(plan({ primaryKind: 'venue_details', messageKey: 'venue_details' }), [search])
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('missing_required_artifact')
    })

    it('rejects a clarification kind carrying events', () => {
      const result = v(
        plan({
          primaryKind: 'clarification',
          messageKey: 'clarification',
          eventSelections: [{ eventId: 'e1', sourceToolCallId: 'call-search' }],
        }),
        [search]
      )
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('inconsistent_response_kind')
    })

    it('rejects more than two clarification questions', () => {
      const result = v(
        plan({
          primaryKind: 'clarification',
          messageKey: 'clarification',
          clarificationQuestions: [{ key: 'which_day' }, { key: 'which_time' }, { key: 'budget' }],
        }),
        []
      )
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('invalid_clarification')
    })

    it('materializes clarification question labels from fixed templates', () => {
      const result = v(
        plan({
          primaryKind: 'clarification',
          messageKey: 'clarification',
          clarificationQuestions: [{ key: 'which_day' }],
        }),
        []
      )
      expect(result.ok).toBe(true)
      expect(result.clarificationQuestions).toEqual([{ key: 'which_day', label: 'Which day are you interested in?' }])
    })

    it('defaults an empty clarification to a safe vague-discovery question (never free prose)', () => {
      const result = v(
        plan({ primaryKind: 'clarification', messageKey: 'clarification', clarificationQuestions: [] }),
        []
      )
      expect(result.ok).toBe(true)
      expect(result.clarificationQuestions).toEqual([
        { key: 'which_category', label: 'What kind of event are you looking for?' },
      ])
    })

    it('materializes the default clarification question in Spanish', () => {
      const result = v(
        plan({ primaryKind: 'clarification', messageKey: 'clarification', clarificationQuestions: [] }),
        [],
        { locale: 'es' }
      )
      expect(result.ok).toBe(true)
      expect(result.clarificationQuestions).toEqual([
        { key: 'which_category', label: '¿Qué tipo de evento buscás?' },
      ])
    })
  })

  describe('share guidance', () => {
    it('accepts share_guidance under the out_of_scope kind', () => {
      const result = v(
        plan({ primaryKind: 'out_of_scope', messageKey: 'share_guidance' }),
        []
      )
      expect(result.ok).toBe(true)
      expect(result.kind).toBe('out_of_scope')
      expect(result.messageKey).toBe('share_guidance')
    })

    it('rejects share_guidance under a different kind', () => {
      const result = v(
        plan({ primaryKind: 'clarification', messageKey: 'share_guidance' }),
        []
      )
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('invalid_message_key')
    })
  })

  describe('suggestion source', () => {
    it('validates a relevant suggestion source and returns it', () => {
      const result = v(
        plan({
          eventSelections: [{ eventId: 'e1', sourceToolCallId: 'call-search' }],
          suggestionSourceToolCallId: 'call-search',
        }),
        [search]
      )
      expect(result.ok).toBe(true)
      expect(result.suggestionSourceToolCallId).toBe('call-search')
      expect(result.suggestionToolCallIds).toEqual(['call-search'])
    })

    it('rejects an irrelevant suggestion source that is a valid but unrelated search', () => {
      const other = searchEntry({ stepIndex: 0, callIndex: 1, toolCallId: 'call-other', events: [event('e3', 'Other')], limit: 3 })
      const result = v(
        plan({
          eventSelections: [{ eventId: 'e1', sourceToolCallId: 'call-search' }],
          suggestionSourceToolCallId: 'call-other',
        }),
        [search, other]
      )
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('invalid_source_tool_call')
    })
  })

  describe('tri-state saved', () => {
    it('marks saved-list events as saved (true)', () => {
      const saved = savedEventsEntry({ toolCallId: 'sv0', events: [event('e1', 'Saved one')] })
      const result = v(
        plan({
          primaryKind: 'saved_events',
          messageKey: 'saved_events',
          eventSelections: [{ eventId: 'e1', sourceToolCallId: 'sv0' }],
        }),
        [saved]
      )
      expect(result.ok).toBe(true)
      expect(result.events[0].saved).toBe(true)
    })

    it('applies check-saved evidence (false) without erasing', () => {
      const s0 = searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('e1', 'One')], limit: 1 })
      const check = checkSavedEntry({ toolCallId: 'cs0', eventId: 'e1', isSaved: false })
      const result = v(plan({ eventSelections: [{ eventId: 'e1', sourceToolCallId: 's0' }] }), [s0, check])
      expect(result.ok).toBe(true)
      expect(result.events[0].saved).toBe(false)
    })

    it('defaults search events to unknown (null) saved state', () => {
      const result = v(plan({ eventSelections: [{ eventId: 'e1', sourceToolCallId: 'call-search' }] }), [search])
      expect(result.ok).toBe(true)
      expect(result.events[0].saved).toBeNull()
    })

    it('a failed mutation does not overwrite prior known saved state', () => {
      const s0 = searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('e1', 'One')], limit: 1 })
      const failed = mutationEntry({ toolCallId: 'm0', toolName: 'save_event', eventId: 'e1', outcome: 'failed' })
      const result = v(
        plan({ eventSelections: [{ eventId: 'e1', sourceToolCallId: 's0' }], operationToolCallIds: ['m0'] }),
        [s0, failed],
        { priorSaved: { e1: true } }
      )
      expect(result.ok).toBe(true)
      expect(result.events[0].saved).toBe(true)
    })

    it('defaults details events to unknown (null) saved state', () => {
      const details = eventDetailsEntry({ toolCallId: 'd0', eventId: 'e1', name: 'Tango' })
      const result = v(
        plan({ primaryKind: 'event_details', messageKey: 'event_details', eventSelections: [{ eventId: 'e1', sourceToolCallId: 'd0' }] }),
        [details]
      )
      expect(result.ok).toBe(true)
      expect(result.events[0].saved).toBeNull()
    })
  })

  describe('rejected vs superseded sources', () => {
    it('rejects a rejected earlier search source with rejected_source', () => {
      const s0 = searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('old', 'Old')], limit: 3 })
      const s1 = searchEntry({ stepIndex: 1, toolCallId: 's1', events: [event('now', 'Now')], limit: 3 })
      const rej = rejectionEntry({ toolCallId: 'rej0', rejectedToolCallIds: ['s0'], stepIndex: 1, callIndex: 1 })
      const result = v(plan({ eventSelections: [{ eventId: 'old', sourceToolCallId: 's0' }] }), [s0, s1, rej])
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('rejected_source')
    })

    it('rejects a superseded (non-rejected) source with superseded_source', () => {
      const s0 = searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('old', 'Old')], limit: 3 })
      const s1 = searchEntry({ stepIndex: 1, toolCallId: 's1', events: [event('now', 'Now')], limit: 3 })
      const result = v(plan({ eventSelections: [{ eventId: 'old', sourceToolCallId: 's0' }] }), [s0, s1])
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('superseded_source')
    })

    it('rejects selecting the only search stage when it is rejected (rejected wins over active)', () => {
      const s0 = searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('old', 'Old')], limit: 3 })
      const rej = rejectionEntry({ toolCallId: 'rej0', rejectedToolCallIds: ['s0'], stepIndex: 1, callIndex: 0 })
      const result = v(plan({ eventSelections: [{ eventId: 'old', sourceToolCallId: 's0' }] }), [s0, rej])
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('rejected_source')
    })

    it('does not ground no_results on a rejected latest stage', () => {
      const s0 = searchEntry({ stepIndex: 0, toolCallId: 's0', events: [], limit: 1 })
      const rej = rejectionEntry({ toolCallId: 'rej0', rejectedToolCallIds: ['s0'], stepIndex: 1, callIndex: 0 })
      const result = v(
        plan({ primaryKind: 'no_results', messageKey: 'no_results', emptySourceToolCallIds: ['s0'] }),
        [s0, rej]
      )
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('invalid_empty_source')
    })
  })

  describe('no_results with selectable events', () => {
    it('rejects no_results when a retained search source has events', () => {
      const s0 = searchEntry({ stepIndex: 0, toolCallId: 's0', events: [event('a', 'A')], limit: 1 })
      const s1 = searchEntry({ stepIndex: 1, toolCallId: 's1', events: [], limit: 1 })
      const ret = retentionEntry({ toolCallId: 'r0', retainedToolCallIds: ['s0'], stepIndex: 1, callIndex: 1 })
      const result = v(
        plan({ primaryKind: 'no_results', messageKey: 'no_results', emptySourceToolCallIds: ['s1'] }),
        [s0, s1, ret]
      )
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('no_results')
    })
  })

  describe('mutation receipts on empty primaries', () => {
    it('preserves mutation receipts on a clarification primary (siblings)', () => {
      const m = mutationEntry({ toolCallId: 'm0', toolName: 'save_event', eventId: 'e1', outcome: 'applied' })
      const result = v(
        plan({ primaryKind: 'clarification', messageKey: 'clarification', clarificationQuestions: [{ key: 'which_day' }], operationToolCallIds: ['m0'] }),
        [m]
      )
      expect(result.ok).toBe(true)
      expect(result.kind).toBe('clarification')
      expect(result.operations).toHaveLength(1)
    })

    it('preserves mutation receipts on an error primary (siblings)', () => {
      const m = mutationEntry({ toolCallId: 'm0', toolName: 'save_event', eventId: 'e1', outcome: 'applied' })
      const result = v(
        plan({ primaryKind: 'error', messageKey: 'error', operationToolCallIds: ['m0'] }),
        [m]
      )
      expect(result.ok).toBe(true)
      expect(result.kind).toBe('error')
      expect(result.operations).toHaveLength(1)
    })
  })

  it('selects the exact requested event id when two events share a name', () => {
    const shared = searchEntry({
      stepIndex: 0,
      toolCallId: 'call-search',
      events: [event('e1', 'Tango night'), event('e2', 'Tango night')],
      limit: 3,
    })
    const result = v(plan({ eventSelections: [{ eventId: 'e2', sourceToolCallId: 'call-search' }] }), [shared])
    expect(result.ok).toBe(true)
    expect(result.events.map((e) => e.id)).toEqual(['e2'])
  })
})
