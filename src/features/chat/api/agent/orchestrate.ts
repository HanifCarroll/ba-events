/**
 * v4 agent-turn orchestration.
 *
 * Ties together the manual work loop, no-tools finalizer, deterministic
 * validation, deterministic fallback, and suggestions into a single
 * `CanonicalChatResponse`. This module is streaming-free so it can run in the
 * API route (streamed) and in the concierge eval (batch) identically.
 *
 * v4: server text is materialized deterministically from the validated closed
 * messageKey (never model prose); the post-validation topic/coverage guards are
 * gone — a validated canonical is never mutated into a semantically different
 * response. Tri-state saved evidence is applied to displayed events.
 */

import type { ModelMessage } from 'ai'
import type {
  CanonicalChatResponse,
  MessageExecutionStep,
} from '#shared/lib/types.ts'
import { CHAT_CONTRACT_VERSION } from '#shared/lib/types.ts'
import type { UserToolContext } from '../user-tools.server.ts'
import { runWorkLoop, type WorkLoopHooks, type WorkLoopResult } from './work-loop.ts'
import { runFinalizer, type FinalizerPlan } from './finalizer.ts'
import { validatePlan, type ValidatedPlan } from './validate.ts'
import { buildFallback } from './fallback.ts'
import { materializeText, materializeClarificationText } from './materialize.ts'
import { buildSanitizedTrace } from './trace.ts'
import type { Ledger, LedgerEntry } from './ledger.ts'
import { generateSuggestions } from '../suggestions.ts'
import type { PriorDisplayGroup } from './follow-up.ts'
import type { SearchEventsInput } from '../tools/search-events.ts'

export interface OrchestrateInput {
  requestId: string
  modelMessages: ModelMessage[]
  userContext: UserToolContext
  locale: 'en' | 'es'
  systemPrompt: string
  originalQuery: string
  priorDisplayedEvents: PriorDisplayGroup[]
  pinnedEventId?: string
  /** Prior known saved state per event id (tri-state; absent = unknown). */
  priorSaved?: Record<string, boolean>
  /** Explicit prior resolved target ids for compound relation validation. */
  resolvedEventId?: string
  resolvedVenueId?: string
  /**
   * True only when the latest raw user query has explicit save/unsave intent.
   * Omitted defaults fail closed: mutation tools are unavailable.
   */
  allowMutations?: boolean
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

function materializeCanonical(
  input: OrchestrateInput,
  validated: ValidatedPlan
): CanonicalChatResponse {
  const text =
    validated.kind === 'clarification'
      ? materializeClarificationText(validated.clarificationQuestions)
      : materializeText({
          messageKey: validated.messageKey,
          locale: input.locale,
          eventName: validated.events[0]?.name,
          directionsVenueName: validated.directions?.venueName,
          venueName: validated.venue?.venueName,
        })
  return {
    contractVersion: CHAT_CONTRACT_VERSION,
    requestId: input.requestId,
    kind: validated.kind,
    messageKey: validated.messageKey,
    text,
    events: validated.events,
    directions: validated.directions,
    venue: validated.venue,
    operations: validated.operations,
    suggestions: [],
    clarificationQuestions: validated.clarificationQuestions,
    provenance: {
      sourceToolCallIds: validated.sourceToolCallIds,
      directionToolCallIds: validated.directionToolCallIds,
      venueToolCallIds: validated.venueToolCallIds,
      mutationToolCallIds: validated.mutationToolCallIds,
      suggestionToolCallIds: validated.suggestionToolCallIds,
      emptySourceToolCallIds: validated.emptySourceToolCallIds,
      retainedSourceToolCallIds: validated.retainedSourceToolCallIds,
      stageIds: validated.stageIds,
      searchAttemptToolCallIds: validated.searchAttemptToolCallIds,
      origin: 'validated',
      fallbackUsed: false,
      fallbackReason: null,
    },
  }
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

function priorSavedFrom(prior: PriorDisplayGroup[]): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const g of prior) {
    for (const e of g.events) {
      if (typeof e.saved === 'boolean') out[e.eventId] = e.saved
    }
  }
  return out
}

export async function orchestrate(input: OrchestrateInput): Promise<OrchestrateResult> {
  const work = await runWorkLoop({
    requestId: input.requestId,
    modelMessages: input.modelMessages,
    systemPrompt: input.systemPrompt,
    userContext: input.userContext,
    locale: input.locale,
    maxWorkGenerations: input.maxWorkGenerations,
    pinnedEventId: input.pinnedEventId,
    allowMutations: input.allowMutations,
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
    pinnedEventId: input.pinnedEventId,
    requestedCount,
    mode,
  })

  let canonical: CanonicalChatResponse
  let validated: ValidatedPlan | null = null

  input.hooks?.onStatus?.('validating')
  if (finalizerResult.ok && finalizerResult.plan) {
    const plan = finalizerResult.plan
    validated = validatePlan(plan, work.ledger, {
      requestId: input.requestId,
      locale: input.locale,
      pinnedEventId: input.pinnedEventId,
      resolvedEventId: input.resolvedEventId,
      resolvedVenueId: input.resolvedVenueId,
      requestedCount,
      priorSaved,
    })

    if (validated.ok) {
      canonical = materializeCanonical(input, validated)
    } else {
      canonical = buildFallback({
        requestId: input.requestId,
        locale: input.locale,
        reason: validated.reason ?? 'invalid_schema',
        ledger: work.ledger,
        requestedCount,
        pinnedEventId: input.pinnedEventId,
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
      pinnedEventId: input.pinnedEventId,
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
    validated?.suggestionSourceToolCallId ?? null
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
