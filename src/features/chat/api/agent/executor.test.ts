import { describe, expect, it } from 'vitest'
import type { ChatEventPayload, DirectionsData } from '#shared/lib/types.ts'
import type { ToolExecutionContext } from '../tools/types.ts'
import type { UserToolContext } from '../user-tools.server.ts'
import {
  runExecutor,
  type ExecutorTools,
  type ExecutorInput,
  type PriorResolvedEvent,
} from './executor.ts'
import type { TurnPlan } from './planner.ts'

const ANON: UserToolContext = { userId: null, isAuthenticated: false }
const CTX: ToolExecutionContext = { userContext: ANON, locale: 'en' }

function ev(id: string, name: string, venueId: string | null = null): ChatEventPayload {
  return {
    id,
    name,
    venue_id: venueId,
    venue_name: venueId ? `Venue ${venueId}` : null,
    venue_neighborhood: null,
    venue_address: null,
    categories: [],
    price: null,
    is_free: false,
    starts_at: '2026-08-20T20:00:00Z',
  } as unknown as ChatEventPayload
}

function dir(eventId?: string, venueId?: string): DirectionsData {
  return {
    venueName: 'Venue',
    address: '123 Calle',
    mapsUrl: 'https://maps.example/dir',
    eventId,
    venueId,
  }
}

function tools(overrides: Partial<ExecutorTools> = {}): ExecutorTools {
  return {
    search: async () => ({ success: true, events: [ev('a', 'A'), ev('b', 'B'), ev('c', 'C')] }),
    eventDetails: async (input) => ({ success: true, events: [ev(input.eventId, `Details ${input.eventId}`)] }),
    directions: async (input) => ({ success: true, directions: dir(input.eventId, input.venueId) }),
    venueDetails: async (input) => ({
      success: true,
      venue: {
        venueId: input.venueId ?? null,
        venueName: 'Venue',
        neighborhood: null,
        address: null,
        website: null,
        instagram: null,
      },
    }),
    listSaved: async () => ({ success: true, events: [ev('s1', 'Saved')] }),
    ...overrides,
  }
}

function run(
  plan: TurnPlan,
  overrides: Partial<ExecutorTools> = {},
  prior = new Map<string, PriorResolvedEvent>(),
  pinned: { eventId?: string; venueId?: string | null; venueName?: string | null } = {}
): ReturnType<typeof runExecutor> {
  const input: ExecutorInput = {
    plan,
    requestId: 'req',
    locale: 'en',
    originalQuery: 'test',
    ctx: CTX,
    prior,
    pinnedEventId: pinned.eventId,
    pinnedVenueId: pinned.venueId,
    pinnedVenueName: pinned.venueName,
    tools: tools(overrides),
  }
  return runExecutor(input)
}

describe('executor: current-search follow-ups', () => {
  it('uses the mismatch message when search returns a genre mismatch', async () => {
    const r = await run(
      { kind: 'search', search: { query: 'jazz' }, count: 1, followUp: null },
      {
        search: async () => ({
          success: true,
          events: [ev('electronic', 'Electronic')],
          metadata: { genreMismatch: 'jazz' },
        }),
      }
    )
    expect(r.canonical.messageKey).toBe('recommendations_mismatch')
  })

  it('search three + details second resolves resultIndex 1 exactly', async () => {
    const r = await run({
      kind: 'search',
      search: { query: 'jazz' },
      count: 3,
      followUp: { action: 'event_details', resultIndex: 1 },
    })
    expect(r.canonical.kind).toBe('event_details')
    expect(r.canonical.events.map((e) => e.id)).toEqual(['b'])
  })

  it('search three + directions second resolves resultIndex 1 exactly', async () => {
    const r = await run({
      kind: 'search',
      search: { query: 'jazz' },
      count: 3,
      followUp: { action: 'directions', resultIndex: 1 },
    })
    expect(r.canonical.kind).toBe('directions')
    expect(r.canonical.directions?.eventId).toBe('b')
  })

  it('invalid resultIndex fails closed to clarification', async () => {
    const r = await run({
      kind: 'search',
      search: { query: 'jazz' },
      count: 3,
      followUp: { action: 'event_details', resultIndex: 4 },
    })
    expect(r.canonical.kind).toBe('clarification')
    expect(r.canonical.events).toEqual([])
  })

  it('forces an empty multi-result search to discovery instead of surprise', async () => {
    let executedInput: Record<string, unknown> | undefined
    await run(
      { kind: 'search', search: {}, count: 3, followUp: null },
      {
        search: async (input) => {
          executedInput = input
          return { success: true, events: [ev('a', 'A'), ev('b', 'B'), ev('c', 'C')] }
        },
      }
    )
    expect(executedInput).toMatchObject({ objective: 'search', limit: 3 })
  })

  it('search three with no follow-up returns all three cards', async () => {
    const r = await run({ kind: 'search', search: { query: 'jazz' }, count: 3, followUp: null })
    expect(r.canonical.kind).toBe('recommendations')
    expect(r.canonical.events.map((e) => e.id)).toEqual(['a', 'b', 'c'])
    expect(r.canonical.provenance.sourceToolCallIds).toEqual(['search:req'])
  })

  it('a romantic weekday search never accumulates cards from prior responses', async () => {
    const prior = new Map([
      ['old:event_0', { eventId: 'speed', venueId: null, venueName: null, name: 'Speed dating', saved: null }],
    ])
    const r = await run(
      { kind: 'search', search: { query: 'romantic weekday' }, count: 3, followUp: null },
      { search: async () => ({ success: true, events: [ev('tango', 'Tango night')] }) },
      prior
    )
    expect(r.canonical.events.map((e) => e.id)).toEqual(['tango'])
  })

  it('empty search grounds no_results', async () => {
    const r = await run(
      { kind: 'search', search: { query: 'nothing' }, count: 3, followUp: null },
      { search: async () => ({ success: true, events: [] }) }
    )
    expect(r.canonical.kind).toBe('no_results')
    expect(r.canonical.events).toEqual([])
  })
})

describe('executor: prior/pinned actions via handles', () => {
  const prior = new Map([
    ['req-1:event_0', { eventId: 'p0', venueId: 'v0', venueName: 'Venue v0', name: 'Tango', saved: null }],
    ['req-1:event_1', { eventId: 'p1', venueId: 'v1', venueName: 'Venue v1', name: 'Jazz', saved: true }],
  ])

  it("prior 'tell me more about the second one' resolves via its exact handle", async () => {
    const r = await run(
      { kind: 'prior_event_action', action: 'event_details', targetHandle: 'req-1:event_1' },
      {},
      prior
    )
    expect(r.canonical.kind).toBe('event_details')
    expect(r.canonical.events.map((event) => event.id)).toEqual(['p1'])
  })

  it('save the second prior event returns its exact card with zero mutations', async () => {
    const r = await run(
      { kind: 'prior_event_action', action: 'show_for_save', targetHandle: 'req-1:event_1' },
      {},
      prior
    )
    expect(r.canonical.events.map((event) => event.id)).toEqual(['p1'])
    expect(r.canonical.operations).toEqual([])
    expect(r.reads.map((read) => read.toolName)).toEqual(['get_event_details'])
  })

  it('an unknown handle fails closed to clarification', async () => {
    const r = await run(
      { kind: 'prior_event_action', action: 'directions', targetHandle: 'req-9:event_9' },
      {},
      prior
    )
    expect(r.canonical.kind).toBe('clarification')
  })

  it('uses a rehydrated venue name when an event has no venue id', async () => {
    let venueInput: Record<string, unknown> | undefined
    const r = await run(
      { kind: 'prior_event_action', action: 'venue_details', targetHandle: 'req:event_0' },
      {
        venueDetails: async (input) => {
          venueInput = input
          return {
            success: true,
            venue: {
              venueId: null,
              venueName: input.venueName ?? 'Unknown',
              neighborhood: null,
              address: null,
              website: null,
              instagram: null,
            },
          }
        },
      },
      new Map([
        ['req:event_0', { eventId: 'p2', venueId: null, venueName: 'Named venue', name: 'Art', saved: null }],
      ])
    )
    expect(venueInput).toEqual({ venueName: 'Named venue' })
    expect(r.canonical.kind).toBe('venue_details')
  })

  it('pinned details and directions use only the server-resolved pin', async () => {
    const details = await run(
      { kind: 'pinned_event_action', action: 'event_details' },
      {},
      prior,
      { eventId: 'pin', venueId: 'vpin' }
    )
    expect(details.canonical.kind).toBe('event_details')
    expect(details.canonical.events.map((e) => e.id)).toEqual(['pin'])

    const dirs = await run(
      { kind: 'pinned_event_action', action: 'directions' },
      {},
      prior,
      { eventId: 'pin', venueId: 'vpin' }
    )
    expect(dirs.canonical.kind).toBe('directions')
    expect(dirs.canonical.directions?.eventId).toBe('pin')
  })
})

describe('executor: save/unsave are zero-mutation show cards', () => {
  it('show_for_save returns the exact card + control message, no mutation call', async () => {
    const calls: string[] = []
    const t = tools({
      eventDetails: async (input) => {
        calls.push('eventDetails')
        return { success: true, events: [ev(input.eventId, 'Exact card')] }
      },
    })
    const r = await run(
      { kind: 'prior_event_action', action: 'show_for_save', targetHandle: 'req-1:event_0' },
      t,
      new Map([['req-1:event_0', { eventId: 'p0', venueId: null, venueName: null, name: 'Exact card', saved: null }]])
    )
    expect(r.canonical.kind).toBe('event_details')
    expect(r.canonical.messageKey).toBe('use_save_control')
    expect(r.canonical.events.map((e) => e.id)).toEqual(['p0'])
    expect(r.canonical.operations).toEqual([])
    expect(calls).toEqual(['eventDetails']) // no save tool exists/called
    expect(r.canonical.text).toContain('Save button')
  })

  it('save the second search result returns only that exact card and performs no mutation', async () => {
    const r = await run({
      kind: 'search',
      search: { query: 'jazz' },
      count: 3,
      followUp: { action: 'show_for_save', resultIndex: 1 },
    })
    expect(r.canonical.messageKey).toBe('use_save_control')
    expect(r.canonical.events.map((e) => e.id)).toEqual(['b'])
    expect(r.canonical.operations).toEqual([])
    expect(r.reads.map((read) => read.toolName)).toEqual(['search_events'])
  })

  it('find-one-save (search + show_for_save result 0) returns that result only', async () => {
    const r = await run({
      kind: 'search',
      search: { query: 'tango' },
      count: 1,
      followUp: { action: 'show_for_save', resultIndex: 0 },
    })
    expect(r.canonical.kind).toBe('event_details')
    expect(r.canonical.messageKey).toBe('use_save_control')
    expect(r.canonical.events.map((e) => e.id)).toEqual(['a'])
    expect(r.canonical.operations).toEqual([])
  })
})

describe('executor: saved events', () => {
  it('keeps the canonical response bounded to five saved cards', async () => {
    const r = await run(
      { kind: 'list_saved', filter: 'all' },
      {
        listSaved: async () => ({
          success: true,
          events: Array.from({ length: 7 }, (_, i) => ev(`s${i}`, `Saved ${i}`)),
        }),
      }
    )
    expect(r.canonical.kind).toBe('saved_events')
    expect(r.canonical.events).toHaveLength(5)
    expect(r.canonical.events.every((event) => event.saved)).toBe(true)
  })
})

describe('executor: deterministic trace + one assistant text', () => {
  it('records a small deterministic execution trace (reads only)', async () => {
    const r = await run({ kind: 'search', search: { query: 'jazz' }, count: 3, followUp: null })
    expect(r.executionTrace).toHaveLength(1)
    expect(r.executionTrace[0].toolCalls[0].toolName).toBe('search_events')
    expect(r.reads.map((x) => x.toolName)).toEqual(['search_events'])
  })

  it('a read that fails produces a deterministic error (never throws)', async () => {
    const r = await run(
      { kind: 'search', search: { query: 'jazz' }, count: 3, followUp: null },
      { search: async () => ({ success: false, error: 'execution_error' }) }
    )
    expect(r.canonical.kind).toBe('error')
    expect(r.canonical.text).toBe('Something went wrong. Please try again.')
  })
})
