/**
 * v5 agent-turn orchestration.
 *
 * Ties together the manual work loop, no-tools finalizer, deterministic
 * validation, the deterministic post-plan mutation executor, deterministic
 * fallback, and suggestions into a single `CanonicalChatResponse`. This module
 * is streaming-free so it can run in the API route (streamed) and in the
 * concierge eval (batch) identically.
 *
 * v5:
 * - Pinned mode is typed (`PinResolution`); a requested-but-unresolved pin is a
 *   typed failure with zero cards and no discovery fallback.
 * - The work loop never executes save/unsave. After validation, the mutation
 *   planner derives the single authorized target (prior/pinned/selected) and
 *   the executor runs it exactly once; the mutation lead key is derived from
 *   the normalized receipts.
 * - Search stages carry 5-state outcomes; a partial search marks the response
 *   incomplete and uses the `partial_results` lead.
 */

import type { ModelMessage } from 'ai'
import type {
  CanonicalChatEventPayload,
  CanonicalChatResponse,
  MessageExecutionStep,
  MessageKey,
  MutationIntent,
  OperationReceipt,
  PinResolution,
  ResponseKind,
} from '#shared/lib/types.ts'
import { CHAT_CONTRACT_VERSION } from '#shared/lib/types.ts'
import type { UserToolContext } from '../user-tools.server.ts'
import { runWorkLoop, type WorkLoopHooks, type WorkLoopResult } from './work-loop.ts'
import { runFinalizer, type FinalizerPlan } from './finalizer.ts'
import { validatePlan, type ValidatedPlan } from './validate.ts'
import { buildFallback } from './fallback.ts'
import {
  materializeText,
  materializeClarificationText,
  materializeClarificationQuestions,
} from './materialize.ts'
import { buildSanitizedTrace } from './trace.ts'
import { Ledger, type LedgerEntry } from './ledger.ts'
import { generateSuggestions } from '../suggestions.ts'
import type { PriorDisplayGroup } from './follow-up.ts'
import type { SearchEventsInput } from '../tools/search-events.ts'
import { planMutation, executeMutations, deriveMutationMessageKey } from './mutation.ts'
import { resolveSavedState } from './record.ts'

export interface OrchestrateInput {
  requestId: string
  modelMessages: ModelMessage[]
  userContext: UserToolContext
  locale: 'en' | 'es'
  systemPrompt: string
  originalQuery: string
  priorDisplayedEvents: PriorDisplayGroup[]
  /** Typed pinned-event resolution (defaults to not requested). */
  pin?: PinResolution
  /** Prior known saved state per event id (tri-state; absent = unknown). */
  priorSaved?: Record<string, boolean>
  /** Explicit prior resolved target ids for compound relation validation. */
  resolvedEventId?: string
  resolvedVenueId?: string
  /** Typed mutation intent (parseMutationIntent result). */
  mutationIntent?: MutationIntent
  maxWorkGenerations?: number
  hooks?: WorkLoopHooks & { onStatus?: (phase: import('#shared/lib/types.ts').ChatStreamStatusPhase) => void }
}

export interface OrchestrateResult {
  canonical: CanonicalChatResponse
  executionTrace: MessageExecutionStep[]
  providerRequestIds: (string | null)[]
  workNotes: string[]
  ledger: Ledger
  stopReason: WorkLoopResult['stopReason']
  finalWorkCalledTools: boolean
}

type Mode = 'pick' | 'discovery' | 'enumeration' | 'other'

/**
 * The display count the finalizer/validator should allow, derived from the
 * LATEST events-bearing read (not directions/venue). A final list_saved_events
 * read allows up to min(returned events, 5); details stay count 1; a final
 * search uses its active stage's actual displayLimit.
 */
function deriveRequestedCount(ledger: Ledger, requestId: string): number {
  const reads = ledger.successfulEventReads(requestId)
  if (reads.length === 0) return 1
  const latest = reads.reduce((best, e) =>
    e.stepIndex > best.stepIndex ||
    (e.stepIndex === best.stepIndex && e.callIndex > best.callIndex)
      ? e
      : best
  )
  switch (latest.kind) {
    case 'search': {
      const active = ledger.activeStage(requestId)
      if (active) {
        const searches = ledger.searchesInStep(active.stepIndex, requestId)
        const last = searches.at(-1)
        return last?.displayLimit ?? last?.searchInput?.limit ?? 1
      }
      return 1
    }
    case 'saved-events':
      return Math.min(latest.events.length, 5)
    case 'event-details':
    default:
      return 1
  }
}

function deriveSearchContext(ledger: Ledger, requestId: string): {
  requestedCount: number
  mode: Mode
  searchInput: SearchEventsInput | null
} {
  const searches = ledger.successfulSearches()
  const last = searches.at(-1)
  const requestedCount = deriveRequestedCount(ledger, requestId)
  const mode: Mode =
    last?.searchInput?.objective === 'surprise'
      ? 'pick'
      : requestedCount > 1
        ? 'discovery'
        : 'other'
  return { requestedCount, mode, searchInput: last?.searchInput ?? null }
}

function priorSavedFrom(prior: PriorDisplayGroup[]): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const g of prior) {
    for (const e of g.events) {
      if (typeof e.saved === 'boolean') out[e.eventId] = e.saved
    }
  }
  return out
}

function findSuggestionSource(
  canonical: CanonicalChatResponse,
  ledger: Ledger,
  preferredId: string | null
): LedgerEntry | null {
  const id = preferredId ?? canonical.provenance.sourceToolCallIds.at(-1) ?? null
  if (!id) return null
  const entry = ledger.find(id)
  if (!entry || entry.kind !== 'search' || !entry.success || !entry.searchInput) return null
  return entry
}

interface AssembledPlan {
  kind: ResponseKind
  messageKey: MessageKey
  events: CanonicalChatEventPayload[]
  directions: ValidatedPlan['directions']
  venue: ValidatedPlan['venue']
  operations: OperationReceipt[]
  mutationToolCallIds: string[]
  sourceToolCallIds: string[]
  directionToolCallIds: string[]
  venueToolCallIds: string[]
  suggestionToolCallIds: string[]
  emptySourceToolCallIds: string[]
  retainedSourceToolCallIds: string[]
  stageIds: string[]
  searchAttemptToolCallIds: string[]
  searchIncomplete: boolean
  clarificationQuestions: ValidatedPlan['clarificationQuestions']
}

function materializeCanonical(
  assembled: AssembledPlan,
  locale: 'en' | 'es',
  requestId: string,
  suggestionSourceToolCallId: string | null
): CanonicalChatResponse {
  const text =
    assembled.kind === 'clarification'
      ? materializeClarificationText(assembled.clarificationQuestions)
      : materializeText({
          messageKey: assembled.messageKey,
          locale,
          eventName: assembled.events[0]?.name,
          directionsVenueName: assembled.directions?.venueName,
          venueName: assembled.venue?.venueName,
        })
  return {
    contractVersion: CHAT_CONTRACT_VERSION,
    requestId,
    kind: assembled.kind,
    messageKey: assembled.messageKey,
    text,
    events: assembled.events,
    directions: assembled.directions,
    venue: assembled.venue,
    operations: assembled.operations,
    suggestions: [],
    clarificationQuestions: assembled.clarificationQuestions,
    provenance: {
      sourceToolCallIds: assembled.sourceToolCallIds,
      directionToolCallIds: assembled.directionToolCallIds,
      venueToolCallIds: assembled.venueToolCallIds,
      mutationToolCallIds: assembled.mutationToolCallIds,
      suggestionToolCallIds: suggestionSourceToolCallId ? [suggestionSourceToolCallId] : [],
      emptySourceToolCallIds: assembled.emptySourceToolCallIds,
      retainedSourceToolCallIds: assembled.retainedSourceToolCallIds,
      stageIds: assembled.stageIds,
      searchAttemptToolCallIds: assembled.searchAttemptToolCallIds,
      searchIncomplete: assembled.searchIncomplete,
      origin: 'validated',
      fallbackUsed: false,
      fallbackReason: null,
    },
  }
}

/** Typed pinned-event failure: zero cards, no discovery, no mutation. */
function buildPinnedFailure(
  input: OrchestrateInput,
  pin: PinResolution & { requested: true }
): OrchestrateResult {
  const text = materializeText({
    messageKey: 'pinned_event_unavailable',
    locale: input.locale,
  })
  const canonical: CanonicalChatResponse = {
    contractVersion: CHAT_CONTRACT_VERSION,
    requestId: input.requestId,
    kind: 'error',
    messageKey: 'pinned_event_unavailable',
    text,
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
  return {
    canonical,
    executionTrace: [],
    providerRequestIds: [],
    workNotes: [],
    ledger: new Ledger(),
    stopReason: 'no_tool_calls',
    finalWorkCalledTools: false,
  }
}

export async function orchestrate(input: OrchestrateInput): Promise<OrchestrateResult> {
  const pin: PinResolution = input.pin ?? { requested: false }

  // Pinned failure: a requested pin that did not resolve is a typed failure —
  // never a silent fallback to discovery.
  if (pin.requested && pin.status !== 'resolved') {
    return buildPinnedFailure(input, pin)
  }
  const pinnedEventId = pin.requested && pin.status === 'resolved' ? pin.eventId : undefined

  const work = await runWorkLoop({
    requestId: input.requestId,
    modelMessages: input.modelMessages,
    systemPrompt: input.systemPrompt,
    userContext: input.userContext,
    locale: input.locale,
    maxWorkGenerations: input.maxWorkGenerations,
    pinnedEventId,
    hooks: input.hooks,
  })

  const { requestedCount, mode } = deriveSearchContext(work.ledger, input.requestId)
  const priorSaved = input.priorSaved ?? priorSavedFrom(input.priorDisplayedEvents)

  // Finalization is ALWAYS a separate generation, even when the last work
  // generation called tools.
  input.hooks?.onStatus?.('finalizing')
  const finalizerResult = await runFinalizer({
    requestId: input.requestId,
    locale: input.locale,
    originalQuery: input.originalQuery,
    priorDisplayedEvents: input.priorDisplayedEvents,
    workNotes: work.workNotes,
    ledger: work.ledger,
    pinnedEventId,
    requestedCount,
    mode,
    mutationIntent: input.mutationIntent,
    resolvedEventId: input.resolvedEventId,
  })

  let canonical: CanonicalChatResponse
  let validated: ValidatedPlan | null = null
  let suggestionSourceToolCallId: string | null = null

  input.hooks?.onStatus?.('validating')
  if (finalizerResult.ok && finalizerResult.plan) {
    const plan: FinalizerPlan = finalizerResult.plan
    validated = validatePlan(plan, work.ledger, {
      requestId: input.requestId,
      locale: input.locale,
      pinnedEventId,
      resolvedEventId: input.resolvedEventId,
      resolvedVenueId: input.resolvedVenueId,
      requestedCount,
      priorSaved,
      mutationIntent: input.mutationIntent,
    })

    if (validated.ok) {
      suggestionSourceToolCallId = validated.suggestionSourceToolCallId
      canonical = await assembleValidated(input, work.ledger, validated, priorSaved, pinnedEventId)
    } else {
      canonical = buildFallback({
        requestId: input.requestId,
        locale: input.locale,
        reason: validated.reason ?? 'invalid_schema',
        ledger: work.ledger,
        requestedCount,
        pinnedEventId,
        resolvedEventId: input.resolvedEventId,
        resolvedVenueId: input.resolvedVenueId,
        priorSaved,
      })
    }
  } else {
    canonical = buildFallback({
      requestId: input.requestId,
      locale: input.locale,
      reason: finalizerResult.error === 'invalid_schema' ? 'invalid_schema' : 'finalizer_error',
      ledger: work.ledger,
      requestedCount,
      pinnedEventId,
      resolvedEventId: input.resolvedEventId,
      resolvedVenueId: input.resolvedVenueId,
      priorSaved,
    })
  }

  // Suggestions operate on the exact validated/fallback search provenance and
  // the actually displayed events — never last-write globals.
  const suggestionSource = findSuggestionSource(
    canonical,
    work.ledger,
    suggestionSourceToolCallId
  )
  if (suggestionSource && canonical.events.length > 0) {
    canonical.suggestions = generateSuggestions({
      originalQuery: input.originalQuery,
      toolInput: suggestionSource.searchInput!,
      results: canonical.events,
      locale: input.locale,
    })
    // Whenever suggestions are generated from an exact search artifact (including
    // fallback where the finalizer supplied no suggestion source), record that
    // exact tool call in provenance — not the finalizer's null.
    canonical.provenance.suggestionToolCallIds = [suggestionSource.toolCallId]
  }

  const executionTrace = buildSanitizedTrace(work.steps)

  return {
    canonical,
    executionTrace,
    providerRequestIds: work.providerRequestIds,
    workNotes: work.workNotes,
    ledger: work.ledger,
    stopReason: work.stopReason,
    finalWorkCalledTools: work.finalWorkCalledTools,
  }
}

/**
 * Assemble the canonical from a validated plan, then run the deterministic
 * post-plan mutation phase (plan + execute exactly once), re-resolving saved
 * state and deriving the mutation/partial lead keys.
 */
async function assembleValidated(
  input: OrchestrateInput,
  ledger: Ledger,
  validated: ValidatedPlan,
  priorSaved: Record<string, boolean> | undefined,
  pinnedEventId: string | undefined
): Promise<CanonicalChatResponse> {
  const intent = input.mutationIntent ?? { kind: 'none' as const }
  const decided = planMutation({
    intent,
    resolvedEventId: input.resolvedEventId,
    pinnedEventId,
    selectedEventId: validated.events[0]?.id,
    selectedSourceToolCallId: validated.sourceToolCallIds[0],
  })

  let kind: ResponseKind = validated.kind
  let messageKey: MessageKey = validated.messageKey
  let events = validated.events
  let directions = validated.directions
  let venue = validated.venue
  let operations: OperationReceipt[] = []
  let mutationToolCallIds: string[] = []
  let directionToolCallIds = validated.directionToolCallIds
  let venueToolCallIds = validated.venueToolCallIds
  let sourceToolCallIds = validated.sourceToolCallIds
  let emptySourceToolCallIds = validated.emptySourceToolCallIds
  let retainedSourceToolCallIds = validated.retainedSourceToolCallIds
  let stageIds = validated.stageIds
  let searchAttemptToolCallIds = validated.searchAttemptToolCallIds
  let searchIncomplete = validated.searchIncomplete
  let clarificationQuestions = validated.clarificationQuestions

  if (decided.status === 'ambiguous') {
    // Ambiguous mutation target: clarify, zero side effects, no cards.
    kind = 'clarification'
    messageKey = 'clarification'
    events = []
    directions = null
    venue = null
    directionToolCallIds = []
    venueToolCallIds = []
    sourceToolCallIds = []
    emptySourceToolCallIds = []
    retainedSourceToolCallIds = []
    stageIds = []
    searchAttemptToolCallIds = []
    searchIncomplete = false
    clarificationQuestions = materializeClarificationQuestions(['which_event'], input.locale)
  } else if (decided.status === 'resolved') {
    // Execute the single authorized mutation exactly once.
    operations = await executeMutations([decided.planned], input.userContext, input.locale)
    mutationToolCallIds = operations.map((r) => r.toolCallId)
    for (const receipt of operations) {
      ledger.recordMutationReceipt(receipt, input.requestId)
    }
    // Re-resolve saved state for displayed events (a mutation may target one).
    events = validated.events.map((ev) => ({
      ...ev,
      saved: resolveSavedState(ev.id, ledger, input.requestId, priorSaved),
    }))
    if (validated.kind === 'mutation_result') {
      messageKey = deriveMutationMessageKey(operations)
    }
  }

  // A partial search that returned events uses the incomplete lead.
  if (kind === 'recommendations' && searchIncomplete) {
    messageKey = 'partial_results'
  }

  return materializeCanonical(
    {
      kind,
      messageKey,
      events,
      directions,
      venue,
      operations,
      mutationToolCallIds,
      sourceToolCallIds,
      directionToolCallIds,
      venueToolCallIds,
      suggestionToolCallIds: validated.suggestionToolCallIds,
      emptySourceToolCallIds,
      retainedSourceToolCallIds,
      stageIds,
      searchAttemptToolCallIds,
      searchIncomplete,
      clarificationQuestions,
    },
    input.locale,
    input.requestId,
    validated.suggestionSourceToolCallId
  )
}
