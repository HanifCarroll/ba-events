import { describe, expect, it } from 'vitest'
import {
  adaptStoredMessageToCanonical,
  adaptV2ToCanonical,
  adaptV3ToCanonical,
  adaptV4ToCanonical,
  canonicalFromDataResponse,
  canonicalToRender,
  deriveLegacyKind,
  isV5Canonical,
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

function v5Provenance(): CanonicalChatResponse['provenance'] {
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
    searchIncomplete: false,
    origin: 'validated',
    fallbackUsed: false,
    fallbackReason: null,
  }
}

function v5Canonical(overrides: Partial<CanonicalChatResponse> = {}): CanonicalChatResponse {
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
    provenance: v5Provenance(),
    ...overrides,
  }
}

describe('v5 canonical read adapters', () => {
  it('preserves recommendation reasons through persisted reload', () => {
    const stored = v5Canonical({
      events: [{ ...canonicalEvent('e1', 'Tango night'), recommendation_reason: 'This matches your music plans.' }, canonicalEvent('e2', 'Jazz night')],
    })
    const reloaded = adaptStoredMessageToCanonical({
      id: 'msg-1',
      attached_data: { canonical: stored },
    })

    expect(reloaded.events[0]?.recommendation_reason).toBe('This matches your music plans.')
    expect(isV5Canonical(reloaded)).toBe(true)
  })

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
    expect(canonical.provenance.searchIncomplete).toBe(false)
    expect(canonical.provenance.sourceToolCallIds).toEqual([])
  })

  it('runtime-filters malformed loose v2 directions instead of trusting the storage type', () => {
    const canonical = adaptV2ToCanonical({
      id: 'msg-1',
      visible_content: 'Here you go',
      attached_data: {
        events: [],
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
    }

    const canonical = adaptV3ToCanonical(v3, { id: 'msg-3', visible_content: 'These are the matches.' })

    expect(canonical.contractVersion).toBe(CHAT_CONTRACT_VERSION)
    expect(canonical.requestId).toBe('req-3')
    expect(canonical.text).toBe('These are the matches.')
    expect(canonical.kind).toBe('recommendations')
    expect(canonical.messageKey).toBe('recommendations')
    expect(canonical.events.map((e) => e.id)).toEqual(['e2', 'e1'])
    expect(canonical.events.every((e) => e.saved === null)).toBe(true)
    expect(canonical.directions).toEqual(directions)
    expect(canonical.venue).toEqual(venue)
    expect(canonical.operations).toEqual([operation])
    expect(canonical.suggestions).toEqual([suggestion])
    expect(canonical.clarificationQuestions).toEqual([])
    expect(canonical.provenance.origin).toBe('legacy_unknown')
    expect(canonical.provenance.searchIncomplete).toBe(false)
  })

  it('adapts a v4 canonical to v5, mapping mutation_result and filling searchIncomplete', () => {
    const v4 = {
      contractVersion: 4,
      requestId: 'req-4',
      kind: 'mutation_result',
      messageKey: 'mutation_result',
      text: 'I updated your saved events.',
      events: [],
      directions: null,
      venue: null,
      operations: [operation],
      suggestions: [],
      clarificationQuestions: [],
      provenance: {
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
      },
    }
    const canonical = adaptV4ToCanonical(v4, { id: 'msg-4', visible_content: 'I updated your saved events.' })

    expect(canonical.contractVersion).toBe(CHAT_CONTRACT_VERSION)
    // Visual text preserved verbatim; the legacy mutation_result key maps to the
    // neutral mutation_mixed lead.
    expect(canonical.text).toBe('I updated your saved events.')
    expect(canonical.messageKey).toBe('mutation_mixed')
    expect(canonical.operations).toEqual([operation])
    expect(canonical.provenance.searchIncomplete).toBe(false)
    expect(canonical.provenance.mutationToolCallIds).toEqual(['op-1'])
  })

  it('rejects a v4 canonical shape with an unknown messageKey safely (v2 fallback)', () => {
    expect(isV4Canonical({ contractVersion: 4, messageKey: 'nonsense' })).toBe(false)
  })

  it('uses the persisted v5 canonical directly, preserving object identity', () => {
    const stored = v5Canonical({ events: [canonicalEvent('e1', 'Tango night')], operations: [operation] })
    const adapted = adaptStoredMessageToCanonical({
      id: 'msg-4',
      response_contract_version: CHAT_CONTRACT_VERSION,
      visible_content: stored.text,
      attached_data: { canonical: stored },
    })
    expect(adapted).toBe(stored)
  })

  it('dispatches v2/v3/v4/v5 through one adapter and rejects unknown versions safely', () => {
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

    const v4Row = {
      id: 'm4',
      response_contract_version: 4,
      visible_content: 'v4 mutation text',
      attached_data: {
        canonical: { contractVersion: 4, requestId: 'r4', kind: 'mutation_result', messageKey: 'mutation_result', text: 'v4 mutation text', events: [], directions: null, venue: null, operations: [], suggestions: [], clarificationQuestions: [], provenance: { sourceToolCallIds: [], directionToolCallIds: [], venueToolCallIds: [], mutationToolCallIds: [], suggestionToolCallIds: [], emptySourceToolCallIds: [], retainedSourceToolCallIds: [], stageIds: [], searchAttemptToolCallIds: [], origin: 'validated', fallbackUsed: false, fallbackReason: null } },
      },
    }
    expect(adaptStoredMessageToCanonical(v4Row).messageKey).toBe('mutation_mixed')

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
        canonical: { requestId: 'r3', kind: 'recommendations', text: 'v3 text', events: [event('e1', 'X')], directions: null, venue: null, operations: [], suggestions: [], provenance: {} },
      },
    }
    const adapted = adaptStoredMessageToCanonical(row)
    expect(adapted.requestId).toBe('r3')
    expect(adapted.provenance.origin).toBe('legacy_unknown')
  })

  it('rejects malformed v5 canonicals instead of casting them as v5', () => {
    expect(isV5Canonical(null)).toBe(false)
    expect(isV5Canonical({ contractVersion: CHAT_CONTRACT_VERSION })).toBe(false)
    expect(isV5Canonical({ ...v5Canonical(), contractVersion: 4 })).toBe(false)
    expect(isV5Canonical(v5Canonical())).toBe(true)
    expect(canonicalFromDataResponse(v5Canonical())).toBeTruthy()
    expect(canonicalFromDataResponse({ contractVersion: 4 })).toBeNull()
  })

  it('validates every event saved value, messageKey, outcome, and provenance array', () => {
    const base = v5Canonical()
    expect(isV5Canonical(base)).toBe(true)

    expect(isV5Canonical({ ...base, events: [{ id: 'e1', name: 'X' }] })).toBe(false)
    expect(isV5Canonical({ ...base, messageKey: undefined })).toBe(false)
    expect(
      isV5Canonical({ ...base, operations: [{ ...operation, outcome: 'weird' }] })
    ).toBe(false)
    expect(
      isV5Canonical({ ...base, provenance: { ...base.provenance, stageIds: undefined } })
    ).toBe(false)
    // Missing the v5 searchIncomplete marker is rejected.
    expect(
      isV5Canonical({ ...base, provenance: { ...base.provenance, searchIncomplete: undefined } })
    ).toBe(false)
    expect(
      isV5Canonical({ ...base, clarificationQuestions: [{ key: 'not-a-key', label: 'x' }] })
    ).toBe(false)
  })

  it('rejects a provenance fallbackReason outside the closed union', () => {
    const base = v5Canonical()
    expect(
      isV5Canonical({ ...base, provenance: { ...base.provenance, fallbackReason: 'made_up_reason' } })
    ).toBe(false)
    expect(
      isV5Canonical({
        ...base,
        provenance: { ...base.provenance, fallbackUsed: true, fallbackReason: 'rejected_source' },
      })
    ).toBe(true)
  })

  it('keeps canonical.text free of operation receipt messages', () => {
    const canonical = v5Canonical({ operations: [operation] })
    for (const op of canonical.operations) {
      expect(canonical.text).not.toContain(op.message)
    }
  })

  it('maps canonical to render fields including clarification questions', () => {
    const canonical = v5Canonical({
      clarificationQuestions: [{ key: 'which_day', label: 'Which day?' }],
      operations: [operation],
      framing: {
        acknowledgement: 'I found a couple of options for your night out.',
        nextStep: 'Want details or directions?',
      },
    })
    const render = canonicalToRender(canonical)
    expect(render.events.map((e) => e.id)).toEqual(['e1', 'e2'])
    expect(render.operations).toEqual([operation])
    expect(render.clarificationQuestions).toHaveLength(1)
    expect(render.framing?.nextStep).toBe('Want details or directions?')
  })
})
