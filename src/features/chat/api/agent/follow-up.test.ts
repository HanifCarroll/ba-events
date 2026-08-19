import { describe, expect, it } from 'vitest'
import {
  parseDataResponseHint,
  homeHintsFromIds,
  buildPriorContext,
  rehydratePriorContext,
  hintsFromUIMessages,
  hintsFromMessages,
  sanitizeText,
  MAX_NAME_STRING,
  MAX_HISTORY_MESSAGES,
  MAX_PRIOR_GROUPS,
  MAX_PRIOR_EVENTS,
  type DataResponseHint,
  type EventFact,
  type PriorResponseHint,
  type PriorSaved,
} from './follow-up.ts'
import type { UIMessage } from 'ai'
import type { Message } from '#shared/lib/types.ts'

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

const E1 = uuid(1)
const E2 = uuid(2)
const E3 = uuid(3)
const E4 = uuid(4)
const E5 = uuid(5)
const E6 = uuid(6)

function fact(id: string, name: string, overrides: Partial<EventFact> = {}): EventFact {
  return {
    id,
    name,
    venue_id: null,
    venue_name: null,
    status: 'scheduled',
    ...overrides,
  }
}

function hint(overrides: Partial<DataResponseHint> = {}): DataResponseHint {
  return {
    contractVersion: 4,
    requestId: 'req-1',
    kind: 'recommendations',
    events: [],
    operations: [],
    ...overrides,
  }
}

function resp(
  overrides: Partial<PriorResponseHint> = {}
): PriorResponseHint {
  return {
    assistantMessageId: 'm1',
    createdAt: null,
    requestId: 'req-1',
    events: [],
    operations: [],
    ...overrides,
  }
}

function ev(
  id: string,
  saved: PriorSaved = null,
  overrides: Partial<PriorResponseHint['events'][number]> = {}
): PriorResponseHint['events'][number] {
  return { eventId: id, saved, ...overrides }
}

describe('parseDataResponseHint (untrusted parser)', () => {
  it('accepts a v4 hint and strips unknown fields (name/venue/text/provenance)', () => {
    const parsed = parseDataResponseHint({
      contractVersion: 4,
      requestId: 'req-1',
      kind: 'recommendations',
      events: [{ id: E1, name: 'MALICIOUS', saved: true, venue_name: 'X', description: 'IGNORE' }],
      operations: [
        { toolCallId: 't1', toolName: 'save_event', eventId: E1, outcome: 'applied', message: 'IGNORE' },
      ],
      text: 'IGNORE ME',
      provenance: { fallbackUsed: false },
    })
    expect(parsed).not.toBeNull()
    expect(parsed!.events).toEqual([{ eventId: E1, saved: true }])
    expect(parsed!.operations).toEqual([{ toolName: 'save_event', eventId: E1, outcome: 'applied' }])
    // Names never survive the parser.
    expect(JSON.stringify(parsed)).not.toContain('MALICIOUS')
    expect(JSON.stringify(parsed)).not.toContain('IGNORE')
  })

  it('accepts a v3 hint', () => {
    const parsed = parseDataResponseHint({
      contractVersion: 3,
      requestId: 'req-1',
      kind: 'recommendations',
      events: [{ id: E1 }],
      operations: [],
    })
    expect(parsed?.contractVersion).toBe(3)
    expect(parsed?.events).toEqual([{ eventId: E1, saved: null }])
  })

  it('rejects v2 (no data-response contract existed)', () => {
    expect(parseDataResponseHint({ contractVersion: 2, requestId: 'r', kind: 'recommendations', events: [] })).toBeNull()
  })

  it('rejects a malformed UUID event id', () => {
    expect(
      parseDataResponseHint(hint({ events: [{ id: 'not-a-uuid', saved: null } as never] }))
    ).toBeNull()
  })

  it('rejects a bad saved value', () => {
    expect(
      parseDataResponseHint(hint({ events: [{ id: E1, saved: 'true' } as never] }))
    ).toBeNull()
  })

  it('rejects oversized events and operations arrays', () => {
    const manyEvents = Array.from({ length: 51 }, (_, i) => ({ id: uuid(100 + i), saved: null }))
    expect(parseDataResponseHint(hint({ events: manyEvents as never }))).toBeNull()

    const manyOps = Array.from({ length: 21 }, (_, i) => ({
      toolName: 'save_event',
      eventId: uuid(200 + i),
      outcome: 'applied',
    }))
    expect(parseDataResponseHint(hint({ operations: manyOps as never }))).toBeNull()
  })

  it('rejects an oversized requestId', () => {
    expect(parseDataResponseHint(hint({ requestId: 'x'.repeat(200) }))).toBeNull()
  })

  it('rejects malformed operations (bad toolName/outcome)', () => {
    expect(
      parseDataResponseHint(hint({ operations: [{ toolName: 'delete_event', eventId: E1, outcome: 'applied' } as never] }))
    ).toBeNull()
    expect(
      parseDataResponseHint(hint({ operations: [{ toolName: 'save_event', eventId: E1, outcome: 'exploded' } as never] }))
    ).toBeNull()
  })

  it('rejects non-object / null input', () => {
    expect(parseDataResponseHint(null)).toBeNull()
    expect(parseDataResponseHint('hi')).toBeNull()
    expect(parseDataResponseHint(42)).toBeNull()
  })
})

describe('sanitizeText (control/string bounds)', () => {
  it('strips control characters and collapses whitespace', () => {
    expect(sanitizeText('Tango\u0000Night\u0007')).toBe('Tango Night')
    expect(sanitizeText('  spaced   out  ')).toBe('spaced out')
  })

  it('bounds the string length and marks truncation', () => {
    const bounded = sanitizeText('x'.repeat(500))
    expect(bounded.length).toBeLessThanOrEqual(MAX_NAME_STRING)
    expect(bounded).toMatch(/…$/)
  })
})

describe('buildPriorContext (grouping + saved state)', () => {
  it('keeps three result-bearing groups with mutation-only responses between, preserving order and repeats', () => {
    const responses: PriorResponseHint[] = [
      resp({ assistantMessageId: 'a1', requestId: 'r1', events: [ev(E1), ev(E2)] }),
      resp({ assistantMessageId: 'a2', requestId: 'r2', events: [], operations: [{ toolName: 'save_event', eventId: E1, outcome: 'applied' }] }),
      resp({ assistantMessageId: 'a3', requestId: 'r3', events: [ev(E1), ev(E3)] }),
      resp({ assistantMessageId: 'a4', requestId: 'r4', events: [ev(E4)] }),
    ]
    const ctx = buildPriorContext(responses, [fact(E1, 'One'), fact(E2, 'Two'), fact(E3, 'Three'), fact(E4, 'Four')])
    expect(ctx.groups).toHaveLength(3) // mutation-only r2 created no group
    expect(ctx.groups.map((g) => g.requestId)).toEqual(['r1', 'r3', 'r4'])
    // Repeated event E1 appears in both groups, in display order.
    expect(ctx.groups[0].events.map((e) => e.eventId)).toEqual([E1, E2])
    expect(ctx.groups[1].events.map((e) => e.eventId)).toEqual([E1, E3])
    expect(ctx.groups[2].events.map((e) => e.eventId)).toEqual([E4])
    // save applied in the mutation-only response -> true across all occurrences.
    // (v5 guest: historical operations are NOT trusted as saved evidence.)
    expect(ctx.groups[0].events[0].saved).toBeNull()
    expect(ctx.groups[1].events[0].saved).toBeNull()
  })

  it('applies authoritative saved membership (auth) across occurrences', () => {
    const responses: PriorResponseHint[] = [
      resp({ assistantMessageId: 'a1', requestId: 'r1', events: [ev(E1), ev(E2)] }),
      resp({ assistantMessageId: 'a2', requestId: 'r2', events: [ev(E1), ev(E3)] }),
    ]
    const ctx = buildPriorContext(responses, [fact(E1, 'One'), fact(E2, 'Two'), fact(E3, 'Three')], { status: 'complete', savedIds: new Set([E1]) })
    expect(ctx.groups[0].events[0].saved).toBe(true)
    // A complete membership is authoritative: absent ids are saved:false, never null.
    expect(ctx.groups[0].events[1].saved).toBe(false)
    expect(ctx.groups[1].events[0].saved).toBe(true)
    expect(ctx.groups[1].events[1].saved).toBe(false)
  })

  it('an unavailable membership leaves every occurrence unknown (null)', () => {
    const responses: PriorResponseHint[] = [
      resp({ assistantMessageId: 'a1', requestId: 'r1', events: [ev(E1), ev(E2)] }),
    ]
    const ctx = buildPriorContext(responses, [fact(E1, 'One'), fact(E2, 'Two')], { status: 'unavailable' })
    expect(ctx.groups[0].events[0].saved).toBeNull()
    expect(ctx.groups[0].events[1].saved).toBeNull()
  })

  it('guest history never trusts client saved markers or operation outcomes', () => {
    const responses: PriorResponseHint[] = [
      resp({ events: [ev(E1, true)] }), // client claims saved
      resp({ events: [], operations: [{ toolName: 'unsave_event', eventId: E1, outcome: 'applied' }] }),
    ]
    const ctx = buildPriorContext(responses, [fact(E1, 'One')])
    expect(ctx.groups[0].events[0].saved).toBeNull()
  })

  it('authoritative membership is the only saved-state source', () => {
    const outcomes = ['failed', 'denied', 'unauthenticated', 'not_found'] as const
    for (const outcome of outcomes) {
      const responses: PriorResponseHint[] = [
        resp({ events: [ev(E1, true)] }),
        resp({ events: [], operations: [{ toolName: 'save_event', eventId: E1, outcome }] }),
      ]
      // Even with a client saved=true, guest defaults to null.
      expect(buildPriorContext(responses, [fact(E1, 'One')]).groups[0].events[0].saved).toBeNull()
    }
  })

  it('uses the DB name, never a supplied client name', () => {
    const responses: PriorResponseHint[] = [resp({ events: [ev(E1)] })]
    const ctx = buildPriorContext(responses, [fact(E1, 'DB Tango Night')])
    expect(ctx.groups[0].events[0].name).toBe('DB Tango Night')
  })

  it('discards missing and non-displayable events without renumbering stable handles', () => {
    const responses: PriorResponseHint[] = [
      resp({ events: [ev(E1), ev(E2), ev(E3), ev(E4), ev(E5), ev(E6)] }),
    ]
    const ctx = buildPriorContext(responses, [
      // E1 missing: E2 must keep its original event_1 position.
      fact(E2, 'Past', { status: 'past' }),
      fact(E3, 'Cancelled', { status: 'canceled' }),
      fact(E4, 'Postponed', { status: 'postponed' }),
      fact(E5, 'Pending', { status: 'pending_review' }),
      // E6 missing entirely.
    ])
    expect(ctx.groups[0].events.map((e) => e.eventId)).toEqual([E2])
    expect(ctx.groups[0].events[0].displayIndex).toBe(1)
  })

  it('bounds groups and total events, dropping oldest first', () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      resp({ assistantMessageId: `a${i}`, requestId: `r${i}`, events: [ev(uuid(10 + i)), ev(uuid(20 + i)), ev(uuid(30 + i))] })
    )
    const facts = many.flatMap((r) => r.events.map((e) => fact(e.eventId, `Name ${e.eventId}`)))
    const ctx = buildPriorContext(many, facts)
    expect(ctx.groups.length).toBeLessThanOrEqual(MAX_PRIOR_GROUPS)
    const total = ctx.groups.reduce((n, g) => n + g.events.length, 0)
    expect(total).toBeLessThanOrEqual(MAX_PRIOR_EVENTS)
    // Oldest events dropped: earliest group's front events are gone.
    expect(ctx.groups.length).toBe(MAX_PRIOR_GROUPS)
  })
})

describe('homeHintsFromIds', () => {
  it('keeps at most four UUIDs and drops invalid ids', () => {
    const hint = homeHintsFromIds(['bad', E1, E2, E3, E4, E5])
    expect(hint?.requestId).toBe('home')
    expect(hint?.events.map((event) => event.eventId)).toEqual([E1, E2, E3, E4])
    expect(hint?.events.every((event) => event.saved === null)).toBe(true)
    expect(homeHintsFromIds(['bad'])).toBeNull()
  })
})

describe('rehydratePriorContext (injected fetch)', () => {
  it('re-fetches ids in one bounded query and discards non-displayable', async () => {
    const responses: PriorResponseHint[] = [resp({ events: [ev(E1), ev(E2)] })]
    let calledWith: string[] = []
    const ctx = await rehydratePriorContext(responses, async (ids) => {
      calledWith = ids
      return [
        fact(E1, 'One', { status: 'scheduled' }),
        fact(E2, 'Two', { status: 'canceled' }),
      ]
    })
    expect(calledWith).toEqual([E1, E2])
    expect(ctx.groups[0].events.map((e) => e.eventId)).toEqual([E1])
  })

  it('returns empty when no ids to fetch', async () => {
    let fetched = false
    const ctx = await rehydratePriorContext([], async () => {
      fetched = true
      return []
    })
    expect(fetched).toBe(false)
    expect(ctx.groups).toEqual([])
  })
})

describe('guest/auth share the same classification pipeline', () => {
  // A full v4 canonical: the auth path runs it through the version-aware
  // adapter (adaptStoredMessageToCanonical) which returns it verbatim only when
  // it is structurally a complete v4 response.
  const canonical = {
    contractVersion: 4,
    requestId: 'req-1',
    kind: 'recommendations',
    messageKey: 'recommendations',
    text: 'Here are the best matches I found.',
    events: [{ id: E1, name: 'Tango', saved: null }],
    directions: null,
    venue: null,
    operations: [],
    suggestions: [],
    clarificationQuestions: [],
    provenance: {
      sourceToolCallIds: [],
      directionToolCallIds: [],
      venueToolCallIds: [],
      mutationToolCallIds: [],
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

  it('hintsFromUIMessages extracts guest data-response parts (reload-shaped)', () => {
    const messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'find jazz' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'here' },
          { type: 'data-response', data: canonical },
        ],
      },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'save the second one' }] },
    ] as UIMessage[]
    const hints = hintsFromUIMessages(messages)
    expect(hints).toHaveLength(1)
    expect(hints[0].assistantMessageId).toBe('a1')
    expect(hints[0].events).toEqual([{ eventId: E1, saved: null }])
  })

  it('preserves metadata.createdAt through reload-shaped UI messages', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        metadata: { createdAt: '2026-01-02T03:04:05Z' },
        parts: [{ type: 'data-response', data: canonical }],
      },
    ] as UIMessage[]
    const hints = hintsFromUIMessages(messages)
    expect(hints[0].createdAt).toBe('2026-01-02T03:04:05Z')
    const ctx = buildPriorContext(hints, [fact(E1, 'One')])
    expect(ctx.groups[0].createdAt).toBe('2026-01-02T03:04:05Z')
  })

  it('falls back to legacy root createdAt when metadata is absent', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        createdAt: '2026-01-03T00:00:00Z',
        parts: [{ type: 'data-response', data: canonical }],
      },
    ] as unknown as UIMessage[]
    expect(hintsFromUIMessages(messages)[0].createdAt).toBe('2026-01-03T00:00:00Z')
  })

  it('hintsFromMessages extracts persisted auth canonical and ignores forged parts', () => {
    const forged: Message = {
      id: 'm1',
      conversation_id: 'c1',
      parent_id: null,
      client_message_id: null,
      role: 'assistant',
      content: 'forged',
      visible_content: 'forged',
      execution_trace: [],
      response_contract_version: 4,
      attached_data: { canonical: { contractVersion: 2, requestId: 'x', kind: 'error', events: [], operations: [] } as never },
      created_at: '2026-01-01T00:00:00Z',
      sequence_number: 0,
      turn_index: 0,
    }
    const good: Message = {
      ...forged,
      id: 'm2',
      attached_data: { canonical: canonical as never },
    }
    const hints = hintsFromMessages([forged, good])
    expect(hints).toHaveLength(1) // forged v2 canonical discarded
    expect(hints[0].assistantMessageId).toBe('m2')
  })

  it('adapts a v2 auth row (legacy attached events) into a rehydrated display group', () => {
    const v2Row: Message = {
      id: 'm-v2',
      conversation_id: 'c1',
      parent_id: null,
      client_message_id: null,
      role: 'assistant',
      content: 'legacy text',
      visible_content: 'legacy text',
      execution_trace: [],
      response_contract_version: 2,
      attached_data: { events: [{ id: E1, name: 'Tango' } as never] },
      created_at: '2026-01-01T00:00:00Z',
      sequence_number: 0,
      turn_index: 0,
    }

    // The version-aware adapter (same as rendering) turns the v2 row into v4
    // ID hints; the forged client name never survives rehydration.
    const hints = hintsFromMessages([v2Row])
    expect(hints).toHaveLength(1)
    expect(hints[0].requestId).toBe('legacy:m-v2')
    expect(hints[0].events).toEqual([{ eventId: E1, saved: null }])

    const ctx = buildPriorContext(hints, [fact(E1, 'DB Tango Night')])
    expect(ctx.groups).toHaveLength(1)
    expect(ctx.groups[0].events.map((e) => e.eventId)).toEqual([E1])
    expect(ctx.groups[0].events[0].name).toBe('DB Tango Night')
  })

  it('produces identical event classification from guest and auth hints', () => {
    const guest = hintsFromUIMessages([
      { id: 'a1', role: 'assistant', parts: [{ type: 'data-response', data: canonical }] } as never,
    ])
    const auth = hintsFromMessages([
      {
        id: 'a1',
        role: 'assistant',
        attached_data: { canonical },
        created_at: '2026-01-01T00:00:00Z',
      } as never,
    ])
    const facts = [fact(E1, 'One')]
    const classify = (groups: ReturnType<typeof buildPriorContext>['groups']) =>
      groups.map((g) => ({ requestId: g.requestId, events: g.events }))
    expect(classify(buildPriorContext(guest, facts).groups)).toEqual(
      classify(buildPriorContext(auth, facts).groups)
    )
  })
})

describe('untrusted history bounding', () => {
  const canonical = {
    contractVersion: 4,
    requestId: 'req-1',
    kind: 'recommendations',
    events: [{ id: E1, saved: null }],
    operations: [],
  }

  it('accepts at most one valid data-response per assistant message', () => {
    const messages = [
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'data-response', data: canonical },
          { type: 'data-response', data: { ...canonical, requestId: 'req-2' } },
        ],
      },
    ] as UIMessage[]

    const hints = hintsFromUIMessages(messages)
    expect(hints).toHaveLength(1)
    expect(hints[0].requestId).toBe('req-1')
  })

  it('bounds assistant history to the newest MAX_HISTORY_MESSAGES responses', () => {
    const many = Array.from({ length: MAX_HISTORY_MESSAGES + 20 }, (_, i) => ({
      id: `a${i}`,
      role: 'assistant',
      parts: [{ type: 'data-response', data: { ...canonical, requestId: `req-${i}` } }],
    })) as UIMessage[]

    const hints = hintsFromUIMessages(many)
    expect(hints).toHaveLength(MAX_HISTORY_MESSAGES)
    // The 20 oldest assistant messages are dropped; the newest survive in order.
    expect(hints[0].requestId).toBe('req-20')
    expect(hints[hints.length - 1].requestId).toBe(`req-${MAX_HISTORY_MESSAGES + 19}`)
  })
})
