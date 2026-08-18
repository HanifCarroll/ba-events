import { describe, expect, it } from 'vitest'
import type { CanonicalChatResponse } from '#shared/lib/types.ts'
import type { UserToolContext } from '../user-tools.server.ts'
import type { ExecutorResult, ExecutorTools } from './executor.ts'
import type { PlannerInput, PlannerResult } from './planner.ts'
import { orchestrate } from './orchestrate.ts'

const ANON: UserToolContext = { userId: null, isAuthenticated: false }

function response(): CanonicalChatResponse {
  return {
    contractVersion: 5,
    requestId: 'req',
    kind: 'out_of_scope',
    messageKey: 'out_of_scope',
    text: 'I can help you find events in Buenos Aires.',
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
      origin: 'validated',
      fallbackUsed: false,
      fallbackReason: null,
    },
  }
}

describe('orchestrate planner context', () => {
  it('passes the bounded previous search and injected BA date to the single planner call', async () => {
    let seen: PlannerInput | null = null
    const planFn = async (input: PlannerInput): Promise<PlannerResult> => {
      seen = input
      return { ok: true, plan: { kind: 'out_of_scope' }, providerRequestId: 'provider' }
    }
    const executeFn = async (): Promise<ExecutorResult> => ({
      canonical: response(),
      executionTrace: [],
      reads: [],
    })

    await orchestrate({
      requestId: 'req',
      userContext: ANON,
      locale: 'en',
      originalQuery: 'Tomorrow instead',
      priorDisplayedEvents: [],
      lastSearch: {
        originalQuery: 'jazz tonight',
        input: { query: 'jazz', timeFilter: 'tonight', limit: 3 },
      },
      currentDateInBA: '2026-08-17',
      planFn,
      executeFn,
      buildToolsFn: () => ({}) as ExecutorTools,
    })

    expect(seen?.lastSearch?.originalQuery).toBe('jazz tonight')
    expect(seen?.currentDateInBA).toBe('2026-08-17')
  })
})
