/**
 * Bounded concierge turn orchestration (v5 replacement).
 *
 * The whole agent turn is: build bounded server-rehydrated state -> ONE planner
 * `generateText` call (`Output.object`, closed `TurnPlan`, NO tools) -> one
 * deterministic executor (`runExecutor`) -> a server-built
 * `CanonicalChatResponse`. There is no work loop, no finalizer, no second model
 * call, no ledger, and no mutation execution. Invalid planner output fails
 * closed to a deterministic error (no repair model call).
 */

import type { CanonicalChatResponse, MessageExecutionStep, PinResolution } from '#shared/lib/types.ts'
import { CHAT_CONTRACT_VERSION } from '#shared/lib/types.ts'
import type { UserToolContext } from '../user-tools.server.ts'
import type { ToolExecutionContext } from '../tools/types.ts'
import { searchEventsTool } from '../tools/search-events.ts'
import { getEventDetailsTool } from '../tools/get-event-details.ts'
import { getDirectionsTool } from '../tools/get-directions.ts'
import { getVenueDetailsTool } from '../tools/get-venue-details.ts'
import { listSavedEventsTool } from '../tools/list-saved-events.ts'
import { handleFor, type PriorDisplayGroup, type VenueFact } from './follow-up.ts'
import { runPlanner, type PriorEventHint } from './planner.ts'
import { runExecutor, type ExecutorTools, type PriorResolvedEvent, type ReadSummary } from './executor.ts'
import { materializeText } from './materialize.ts'

export interface OrchestrateInput {
  requestId: string
  userContext: UserToolContext
  locale: 'en' | 'es'
  originalQuery: string
  priorDisplayedEvents: PriorDisplayGroup[]
  venueByEventId?: Map<string, VenueFact>
  pin?: PinResolution
  /** Rehydrated pinned-event facts (server-owned, never client input). */
  pinFacts?: { name: string; venueName: string | null } | null
  // Test seams (default to the real planner/executor/tool wiring).
  planFn?: typeof runPlanner
  executeFn?: typeof runExecutor
  buildToolsFn?: (ctx: ToolExecutionContext) => ExecutorTools
}

export interface OrchestrateResult {
  canonical: CanonicalChatResponse
  executionTrace: MessageExecutionStep[]
  reads: ReadonlyArray<ReadSummary>
  providerRequestId: string | null
}

function buildTools(ctx: ToolExecutionContext): ExecutorTools {
  return {
    search: async (input) =>
      (await searchEventsTool.execute(input, ctx)) as unknown as Awaited<
        ReturnType<ExecutorTools['search']>
      >,
    eventDetails: async (input) =>
      (await getEventDetailsTool.execute(input, ctx)) as unknown as Awaited<
        ReturnType<ExecutorTools['eventDetails']>
      >,
    directions: async (input) =>
      (await getDirectionsTool.execute(input, ctx)) as unknown as Awaited<
        ReturnType<ExecutorTools['directions']>
      >,
    venueDetails: async (input) =>
      (await getVenueDetailsTool.execute(input, ctx)) as unknown as Awaited<
        ReturnType<ExecutorTools['venueDetails']>
      >,
    listSaved: async (input) =>
      (await listSavedEventsTool.execute(input, ctx)) as unknown as Awaited<
        ReturnType<ExecutorTools['listSaved']>
      >,
  }
}

function emptyProvenance(): CanonicalChatResponse['provenance'] {
  return {
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
  }
}

/** Typed pinned-event failure: zero cards, no planner call, no discovery. */
function buildPinnedFailure(requestId: string, locale: 'en' | 'es'): CanonicalChatResponse {
  return {
    contractVersion: CHAT_CONTRACT_VERSION,
    requestId,
    kind: 'error',
    messageKey: 'pinned_event_unavailable',
    text: materializeText({ messageKey: 'pinned_event_unavailable', locale }),
    events: [],
    directions: null,
    venue: null,
    operations: [],
    suggestions: [],
    clarificationQuestions: [],
    provenance: emptyProvenance(),
  }
}

/** Fail-closed deterministic error for planner/provider failure (no repair call). */
function buildPlannerError(
  requestId: string,
  locale: 'en' | 'es',
  reason: 'invalid_schema' | 'planner_error'
): CanonicalChatResponse {
  return {
    contractVersion: CHAT_CONTRACT_VERSION,
    requestId,
    kind: 'error',
    messageKey: 'error',
    text: materializeText({ messageKey: 'error', locale }),
    events: [],
    directions: null,
    venue: null,
    operations: [],
    suggestions: [],
    clarificationQuestions: [],
    provenance: {
      ...emptyProvenance(),
      origin: 'fallback',
      fallbackUsed: true,
      fallbackReason: reason,
    },
  }
}

function buildPriorState(
  groups: PriorDisplayGroup[],
  venueByEventId: Map<string, VenueFact> | undefined
): { hints: PriorEventHint[]; map: Map<string, PriorResolvedEvent> } {
  const hints: PriorEventHint[] = []
  const map = new Map<string, PriorResolvedEvent>()
  groups.forEach((g, responseOrder) => {
    for (const ev of g.events) {
      const handle = handleFor(g.requestId, ev.displayIndex)
      const venue = venueByEventId?.get(ev.eventId)
      const resolved: PriorResolvedEvent = {
        eventId: ev.eventId,
        venueId: venue?.venueId ?? null,
        venueName: venue?.venueName ?? null,
        name: ev.name,
        saved: ev.saved,
      }
      map.set(handle, resolved)
      hints.push({
        handle,
        responseOrder,
        displayOrder: ev.displayIndex,
        name: ev.name,
        venueName: venue?.venueName ?? null,
        saved: ev.saved,
      })
    }
  })
  return { hints, map }
}

export async function orchestrate(input: OrchestrateInput): Promise<OrchestrateResult> {
  const pin: PinResolution = input.pin ?? { requested: false }

  // A requested pin that did not resolve is a typed failure — never a silent
  // fallback to discovery and never a planner call.
  if (pin.requested && pin.status !== 'resolved') {
    return {
      canonical: buildPinnedFailure(input.requestId, input.locale),
      executionTrace: [],
      reads: [],
      providerRequestId: null,
    }
  }

  const { hints, map } = buildPriorState(input.priorDisplayedEvents, input.venueByEventId)
  const pinned =
    pin.requested && pin.status === 'resolved'
      ? (input.pinFacts ?? null)
      : null

  const planFn = input.planFn ?? runPlanner
  const executeFn = input.executeFn ?? runExecutor
  const tools = (input.buildToolsFn ?? buildTools)({
    userContext: input.userContext,
    locale: input.locale,
  })

  const plannerResult = await planFn({
    originalQuery: input.originalQuery,
    locale: input.locale,
    prior: hints,
    pinned,
  })

  if (!plannerResult.ok) {
    return {
      canonical: buildPlannerError(input.requestId, input.locale, plannerResult.error),
      executionTrace: [],
      reads: [],
      providerRequestId: plannerResult.providerRequestId,
    }
  }

  const executed = await executeFn({
    plan: plannerResult.plan,
    requestId: input.requestId,
    locale: input.locale,
    originalQuery: input.originalQuery,
    ctx: { userContext: input.userContext, locale: input.locale },
    prior: map,
    pinnedEventId: pin.requested && pin.status === 'resolved' ? pin.eventId : undefined,
    pinnedVenueId: pin.requested && pin.status === 'resolved' ? pin.venueId : undefined,
    pinnedVenueName: pinned?.venueName ?? undefined,
    tools,
  })

  return {
    canonical: executed.canonical,
    executionTrace: executed.executionTrace,
    reads: executed.reads,
    providerRequestId: plannerResult.providerRequestId,
  }
}
