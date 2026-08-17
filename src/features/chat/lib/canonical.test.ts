import { describe, expect, it } from 'vitest'
import {
  adaptStoredMessageToCanonical,
  adaptV2ToCanonical,
  adaptV3ToCanonical,
  canonicalFromDataResponse,
  canonicalToRender,
  deriveLegacyKind,
  isV4Canonical,
} from './canonical.ts'
import {
  CHAT_CONTRACT_VERSION,
  type CanonicalChatEventPayload,
  type CanonicalChatResponse,
  type ChatEventPayload,
  type DirectionsData,
  type OperationReceipt,
  type RefinementSuggestion,
  type SavedState,
  type VenueDetailsData,
} from '#shared/lib/types.ts'

function event(id: string, name: string): ChatEventPayload {
  return {
    id,
    name,
    venue_name: 'Niceto',
    starts_at: '2026-08-20T22:00:00Z',
    categories: ['music'],
  } as ChatEventPayload
}

function canonicalEvent(id: string, name: string, saved: SavedState = null): CanonicalChatEventPayload {
  return { ...event(id, name), saved }
}

const directions: DirectionsData = {
  venueName: 'Niceto',
  address: 'Niceto Vega 5510',
  mapsUrl: 'https://maps.example/x',
}

const venue: VenueDetailsData = {
  venueId: 'venue-1',
  venueName: 'Niceto',
  neighborhood: 'Palermo',
  address: 'Niceto Vega 5510',
  website: null,
  instagram: null,
}

const operation: OperationReceipt = {
  toolCallId: 'op-1',
  toolName: 'save_event',
  eventId: 'e1',
  outcome: 'applied',
  message: 'Saved it to your list.',
}

const suggestion: RefinementSuggestion = {
  id: 's1',
  label: 'Later this week',
  prompt: 'show later',
  type: 'time',
}

function v4Provenance(): CanonicalChatResponse['provenance'] {
  return {
    sourceToolCallIds: ['src-1'],
    directionToolCallIds: [],
    venueToolCallIds: [],
    mutationToolCallIds: ['op-1'],
    suggestionToolCallIds: [],
    emptySourceToolCallIds: [],
    retainedSourceToolCallIds: [],
    stageIds: [],
    searchAttemptToolCallIds: [],
    origin: 'validated',
    fallbackUsed: false,
    fallbackReason: null,
  }
}

function v4Canonical(overrides: Partial<CanonicalChatResponse> = {}): CanonicalChatResponse {
  return {
    contractVersion: CHAT_CONTRACT_VERSION,
    requestId: 'req-1',
    kind: 'recommendations',
    messageKey: 'recommendations',
    text: 'Here are the best matches I found.',
    events: [canonicalEvent('e1', 'Tango night'), canonicalEvent('e2', 'Jazz night')],
    directions: null,
    venue: null,
    operations: [],
    suggestions: [],
    clarificationQuestions: [],
    provenance: v4Provenance(),
    ...overrides,
  }
}

describe('v4 canonical read adapters', () => {
  it('adapts v2 legacy rows (visible_content + compound attachments) without rewriting', () => {
    const canonical = adaptV2ToCanonical({
      id: 'msg-1',
      visible_content: 'Here you go',
      attached_data: {
        events: [event('e1', 'Tango night'), event('e2', 'Jazz night')],
        suggestions: [suggestion],
        directions,
      },
    })

    expect(canonical.contractVersion).toBe(CHAT_CONTRACT_VERSION)
    expect(canonical.requestId).toBe('legacy:msg-1')
    expect(canonical.text).toBe('Here you go')
    expect(canonical.kind).toBe('recommendations')
    expect(canonical.messageKey).toBe('recommendations')
    expect(canonical.events.map((e) => e.id)).toEqual(['e1', 'e2'])
    expect(canonical.events.every((e) => e.saved === null)).toBe(true)
    expect(canonical.directions).toEqual(directions)
    expect(canonical.venue).toBeNull()
    expect(canonical.operations).toEqual([])
    expect(canonical.suggestions).toHaveLength(1)
    expect(canonical.clarificationQuestions).toEqual([])
    expect(canonical.provenance.origin).toBe('legacy_unknown')
    expect(canonical.provenance.sourceToolCallIds).toEqual([])
    expect(canonical.provenance.directionToolCallIds).toEqual([])
    expect(canonical.provenance.emptySourceToolCallIds).toEqual([])
    expect(canonical.provenance.retainedSourceToolCallIds).toEqual([])
    expect(canonical.provenance.stageIds).toEqual([])
    expect(canonical.provenance.searchAttemptToolCallIds).toEqual([])
  })

  it('runtime-filters malformed loose v2 directions instead of trusting the storage type', () => {
    const canonical = adaptV2ToCanonical({
      id: 'msg-1',
      visible_content: 'Here you go',
      attached_data: {
        events: [],
        // Malformed: missing address and mapsUrl.
        directions: { venueName: 'Niceto' } as unknown as DirectionsData,
      },
    })
    expect(canonical.directions).toBeNull()
    expect(canonical.kind).not.toBe('directions')
  })

  it('derives legacy kind from attached data', () => {
    expect(deriveLegacyKind({ events: [event('e1', 'X')] }, 'x')).toBe('recommendations')
    expect(deriveLegacyKind({ directions }, 'x')).toBe('directions')
    expect(deriveLegacyKind({}, '')).toBe('no_results')
    expect(deriveLegacyKind({}, 'hi')).toBe('out_of_scope')
  })

  it('adapts v3 canonical with compound visual data, preserving text/order/cards', () => {
    const v3 = {
      contractVersion: 3,
      requestId: 'req-3',
      kind: 'recommendations',
      text: 'These are the matches.',
      events: [event('e2', 'Jazz night'), event('e1', 'Tango night')],
      directions,
      venue,
      operations: [operation],
      suggestions: [suggestion],
      provenance: {
        sourceToolCallIds: ['old-src'],
        directionToolCallIds: ['old-dir'],
        venueToolCallIds: ['old-venue'],
        mutationToolCallIds: ['old-op'],
        suggestionToolCallIds: ['old-sug'],
        origin: 'validated',
        fallbackUsed: false,
        fallbackReason: null,
      },
    }

    const canonical = adaptV3ToCanonical(v3, { id: 'msg-3', visible_content: 'These are the matches.' })

    expect(canonical.contractVersion).toBe(CHAT_CONTRACT_VERSION)
    expect(canonical.requestId).toBe('req-3')
    expect(canonical.text).toBe('These are the matches.')
    expect(canonical.kind).toBe('recommendations')
    expect(canonical.messageKey).toBe('recommendations')
    // Event order and card data preserved exactly; saved forced to null.
    expect(canonical.events.map((e) => e.id)).toEqual(['e2', 'e1'])
    expect(canonical.events.every((e) => e.saved === null)).toBe(true)
    expect(canonical.directions).toEqual(directions)
    expect(canonical.venue).toEqual(venue)
    expect(canonical.operations).toEqual([operation])
    expect(canonical.suggestions).toEqual([suggestion])
    expect(canonical.clarificationQuestions).toEqual([])
    // Provenance is legacy_unknown with empty arrays (no trusted reconstruction).
    expect(canonical.provenance.origin).toBe('legacy_unknown')
    expect(canonical.provenance.sourceToolCallIds).toEqual([])
    expect(canonical.provenance.directionToolCallIds).toEqual([])
    expect(canonical.provenance.venueToolCallIds).toEqual([])
    expect(canonical.provenance.mutationToolCallIds).toEqual([])
    expect(canonical.provenance.suggestionToolCallIds).toEqual([])
    expect(canonical.provenance.fallbackUsed).toBe(false)
  })

  it('uses the persisted v4 canonical directly, preserving object identity', () => {
    const stored = v4Canonical({ events: [canonicalEvent('e1', 'Tango night')], operations: [operation] })
    const adapted = adaptStoredMessageToCanonical({
      id: 'msg-4',
      response_contract_version: CHAT_CONTRACT_VERSION,
      visible_content: stored.text,
      attached_data: { canonical: stored },
    })
    expect(adapted).toBe(stored)
  })

  it('dispatches v2/v3/v4 through one adapter and rejects unknown versions safely', () => {
    const v2Row = {
      id: 'm2',
      response_contract_version: 2,
      visible_content: 'legacy text',
      attached_data: { events: [event('e1', 'X')] },
    }
    expect(adaptStoredMessageToCanonical(v2Row).provenance.origin).toBe('legacy_unknown')
    expect(adaptStoredMessageToCanonical(v2Row).text).toBe('legacy text')

    const v3Row = {
      id: 'm3',
      response_contract_version: 3,
      visible_content: 'v3 text',
      attached_data: {
        canonical: { contractVersion: 3, requestId: 'r3', kind: 'recommendations', text: 'v3 text', events: [event('e1', 'X')], directions: null, venue: null, operations: [], suggestions: [], provenance: {} },
      },
    }
    const fromV3 = adaptStoredMessageToCanonical(v3Row)
    expect(fromV3.contractVersion).toBe(CHAT_CONTRACT_VERSION)
    expect(fromV3.provenance.origin).toBe('legacy_unknown')

    // Unknown runtime version inside canonical → safe legacy fallback, no throw.
    const unknownRow = {
      id: 'm99',
      response_contract_version: 99,
      visible_content: 'unknown',
      attached_data: {
        canonical: { contractVersion: 99, requestId: 'r99', kind: 'recommendations', text: 'unknown', events: [], directions: null, venue: null, operations: [], suggestions: [], provenance: {} },
      },
    }
    const unknown = adaptStoredMessageToCanonical(unknownRow)
    expect(unknown.contractVersion).toBe(CHAT_CONTRACT_VERSION)
    expect(unknown.provenance.origin).toBe('legacy_unknown')
  })

  it('never lets the DB column version override an explicit unknown runtime version', () => {
    const row = {
      id: 'm99',
      response_contract_version: 3,
      visible_content: 'unknown text',
      attached_data: {
        canonical: {
          contractVersion: 99,
          requestId: 'r99',
          kind: 'recommendations',
          text: 'should not be trusted',
          events: [],
          directions: null,
          venue: null,
          operations: [],
          suggestions: [],
          provenance: {},
        },
      },
    }
    const adapted = adaptStoredMessageToCanonical(row)
    // Rejected to the legacy v2 path (legacy requestId + visible_content text),
    // NOT adapted as v3 (which would have preserved requestId 'r99').
    expect(adapted.requestId).toBe('legacy:m99')
    expect(adapted.text).toBe('unknown text')
    expect(adapted.provenance.origin).toBe('legacy_unknown')
  })

  it('uses the DB column version only when the runtime version is absent', () => {
    const row = {
      id: 'm3',
      response_contract_version: 3,
      visible_content: 'v3 text',
      attached_data: {
        // No contractVersion on the payload — column version is the fallback.
        canonical: { requestId: 'r3', kind: 'recommendations', text: 'v3 text', events: [event('e1', 'X')], directions: null, venue: null, operations: [], suggestions: [], provenance: {} },
      },
    }
    const adapted = adaptStoredMessageToCanonical(row)
    expect(adapted.requestId).toBe('r3')
    expect(adapted.provenance.origin).toBe('legacy_unknown')
  })

  it('rejects malformed v4 canonicals instead of casting them as v4', () => {
    expect(isV4Canonical(null)).toBe(false)
    expect(isV4Canonical({ contractVersion: CHAT_CONTRACT_VERSION })).toBe(false)
    expect(isV4Canonical({ ...v4Canonical(), contractVersion: 3 })).toBe(false)
    expect(isV4Canonical(v4Canonical())).toBe(true)
    expect(canonicalFromDataResponse(v4Canonical())).toBeTruthy()
    expect(canonicalFromDataResponse({ contractVersion: 3 })).toBeNull()
  })

  it('validates every event saved value, messageKey, outcome, and provenance array', () => {
    const base = v4Canonical()
    expect(isV4Canonical(base)).toBe(true)

    // Event missing the explicit saved tri-state.
    expect(isV4Canonical({ ...base, events: [{ id: 'e1', name: 'X' }] })).toBe(false)
    // Missing messageKey.
    expect(isV4Canonical({ ...base, messageKey: undefined })).toBe(false)
    // Invalid operation outcome.
    expect(
      isV4Canonical({ ...base, operations: [{ ...operation, outcome: 'weird' }] })
    ).toBe(false)
    // Missing provenance array.
    expect(
      isV4Canonical({ ...base, provenance: { ...base.provenance, stageIds: undefined } })
    ).toBe(false)
    // Bad clarification shape.
    expect(
      isV4Canonical({ ...base, clarificationQuestions: [{ key: 'not-a-key', label: 'x' }] })
    ).toBe(false)
  })

  it('rejects a provenance fallbackReason outside the closed union', () => {
    const base = v4Canonical()
    expect(
      isV4Canonical({ ...base, provenance: { ...base.provenance, fallbackReason: 'made_up_reason' } })
    ).toBe(false)
    // A valid closed reason (with fallbackUsed true) still validates.
    expect(
      isV4Canonical({
        ...base,
        provenance: { ...base.provenance, fallbackUsed: true, fallbackReason: 'rejected_source' },
      })
    ).toBe(true)
  })

  it('keeps canonical.text free of operation receipt messages', () => {
    const canonical = v4Canonical({ operations: [operation] })
    // Deterministic contract: the materialized text block must never duplicate
    // the separately-rendered operation receipt message.
    for (const op of canonical.operations) {
      expect(canonical.text).not.toContain(op.message)
    }
  })

  it('maps canonical to render fields including clarification questions', () => {
    const canonical = v4Canonical({
      clarificationQuestions: [{ key: 'which_day', label: 'Which day?' }],
      operations: [operation],
    })
    const render = canonicalToRender(canonical)
    expect(render.events.map((e) => e.id)).toEqual(['e1', 'e2'])
    expect(render.operations).toEqual([operation])
    expect(render.clarificationQuestions).toHaveLength(1)
  })
})
