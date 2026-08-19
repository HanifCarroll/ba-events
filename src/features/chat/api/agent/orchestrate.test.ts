import { describe, expect, it } from 'vitest'
import type { CanonicalChatResponse, MessageExecutionStep, PinResolution } from '#shared/lib/types.ts'
import type { UserToolContext } from '../user-tools.server.ts'
import type { PriorDisplayGroup } from './follow-up.ts'
import { orchestrate } from './orchestrate.ts'
import type { ExecutorResult, ExecutorTools } from './executor.ts'
import type { PlannerResult, TurnPlan } from './planner.ts'

const ANON: UserToolContext = { userId: null, isAuthenticated: false }

function stubResult(canonical: CanonicalChatResponse): ExecutorResult {
  return {
    canonical,
    executionTrace: [] as MessageExecutionStep[],
    reads: [],
  }
}

function errorCanonical(requestId: string): CanonicalChatResponse {
  return {
    contractVersion: 5,
    requestId,
    kind: 'error',
    messageKey: 'error',
    text: 'Something went wrong. Please try again.',
    events: [],
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
      searchIncomplete: false,
      origin: 'fallback',
      fallbackUsed: true,
      fallbackReason: 'invalid_schema',
    },
  }
}

const PLAN: TurnPlan = { kind: 'out_of_scope' }

describe('orchestrate: single planner call, no work loop/finalizer', () => {
  it('calls the planner exactly once and the executor exactly once', async () => {
    let planCalls = 0
    let executeCalls = 0
    const planFn = async (): Promise<PlannerResult> => {
      planCalls++
      return { ok: true, plan: PLAN, providerRequestId: 'prov-1' }
    }
    const executeFn = async (): Promise<ExecutorResult> => {
      executeCalls++
      return stubResult(errorCanonical('req'))
    }

    const result = await orchestrate({
      requestId: 'req',
      userContext: ANON,
      locale: 'en',
      originalQuery: 'hi',
      priorDisplayedEvents: [],
      planFn,
      executeFn,
      buildToolsFn: () => ({}) as ExecutorTools,
    })

    expect(planCalls).toBe(1)
    expect(executeCalls).toBe(1)
    expect(result.providerRequestId).toBe('prov-1')
  })

  it('fails closed to a deterministic error when the planner fails (no repair call)', async () => {
    let executeCalls = 0
    const planFn = async (): Promise<PlannerResult> => ({
      ok: false,
      error: 'invalid_schema',
      providerRequestId: null,
    })
    const executeFn = async (): Promise<ExecutorResult> => {
      executeCalls++
      return stubResult(errorCanonical('req'))
    }

    const result = await orchestrate({
      requestId: 'req',
      userContext: ANON,
      locale: 'en',
      originalQuery: 'hi',
      priorDisplayedEvents: [],
      planFn,
      executeFn,
      buildToolsFn: () => ({}) as ExecutorTools,
    })

    expect(executeCalls).toBe(0)
    expect(result.canonical.kind).toBe('error')
    expect(result.canonical.provenance.fallbackUsed).toBe(true)
    expect(result.canonical.provenance.fallbackReason).toBe('invalid_schema')
  })

  it('a resolved pin skips planning and runs event_details for the pinned id', async () => {
    let planCalls = 0
    let detailsId: string | undefined
    const planFn = async (): Promise<PlannerResult> => {
      planCalls++
      return { ok: true, plan: PLAN, providerRequestId: null }
    }
    const event = { id: 'pinned-id', name: 'Pinned event' } as never
    const result = await orchestrate({
      requestId: 'req',
      userContext: ANON,
      locale: 'en',
      originalQuery: 'tell me about it',
      priorDisplayedEvents: [],
      pin: { requested: true, status: 'resolved', eventId: 'pinned-id', venueId: null },
      planFn,
      buildToolsFn: () => ({
        search: async () => ({ success: true, events: [] }),
        eventDetails: async (input) => {
          detailsId = input.eventId
          return { success: true, events: [event] }
        },
        directions: async () => ({ success: true, directions: null }),
        venueDetails: async () => ({ success: true, venue: null }),
        listSaved: async () => ({ success: true, events: [] }),
      }),
    })

    expect(planCalls).toBe(0)
    expect(detailsId).toBe('pinned-id')
    expect(result.reads.map((read) => read.toolName)).toEqual(['get_event_details'])
    expect(result.canonical.kind).toBe('event_details')
  })

  it('a requested-but-unresolved pin is a typed failure with zero planner calls', async () => {
    let planCalls = 0
    const planFn = async (): Promise<PlannerResult> => {
      planCalls++
      return { ok: true, plan: PLAN, providerRequestId: null }
    }
    const pin: PinResolution = { requested: true, status: 'missing', eventIdHint: 'x' }

    const result = await orchestrate({
      requestId: 'req',
      userContext: ANON,
      locale: 'en',
      originalQuery: 'hi',
      priorDisplayedEvents: [],
      pin,
      planFn,
      executeFn: async () => stubResult(errorCanonical('req')),
      buildToolsFn: () => ({}) as ExecutorTools,
    })

    expect(planCalls).toBe(0)
    expect(result.canonical.kind).toBe('error')
    expect(result.canonical.messageKey).toBe('pinned_event_unavailable')
    expect(result.canonical.events).toEqual([])
  })
})

describe('orchestrate: prior handle map', () => {
  it("resolves prior 'second one' to its handle through the rehydrated map", async () => {
    const groups: PriorDisplayGroup[] = [
      {
        assistantMessageId: 'a1',
        requestId: 'req-1',
        createdAt: null,
        events: [
          { eventId: 'p0', displayIndex: 0, name: 'Tango', saved: null },
          { eventId: 'p1', displayIndex: 1, name: 'Jazz', saved: true },
        ],
      },
    ]
    const planFn = async (): Promise<PlannerResult> => ({
      ok: true,
      plan: { kind: 'prior_event_action', action: 'directions', targetHandle: 'req-1:event_1' },
      providerRequestId: null,
    })
    const tools: ExecutorTools = {
      search: async () => ({ success: true, events: [] }),
      eventDetails: async () => ({ success: true, events: [] }),
      directions: async (input) => ({
        success: true,
        directions: { venueName: 'V', address: 'A', mapsUrl: 'https://m', eventId: input.eventId },
      }),
      venueDetails: async () => ({ success: true, venue: null }),
      listSaved: async () => ({ success: true, events: [] }),
    }

    const result = await orchestrate({
      requestId: 'req',
      userContext: ANON,
      locale: 'en',
      originalQuery: 'directions to the second one',
      priorDisplayedEvents: groups,
      planFn,
      buildToolsFn: () => tools,
    })

    expect(result.canonical.kind).toBe('directions')
    expect(result.canonical.directions?.eventId).toBe('p1')
    expect(result.reads.map((r) => r.toolName)).toEqual(['get_directions'])
  })
})
