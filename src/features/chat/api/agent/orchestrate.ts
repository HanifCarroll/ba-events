/**
 * v3 agent-turn orchestration.
 *
 * Ties together the manual work loop, no-tools finalizer, deterministic
 * validation, deterministic fallback, suggestions, and coverage/off-topic
 * guards into a single `CanonicalChatResponse`. This module is streaming-free
 * so it can run in the API route (streamed) and in the concierge eval
 * (batch) identically.
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
import { buildSanitizedTrace } from './trace.ts'
import type { Ledger, LedgerEntry } from './ledger.ts'
import { generateSuggestions } from '../suggestions.ts'
import { guardForOffTopic } from '../topic-guard.ts'
import { guardCoverageClaims, type CoverageInfo } from '../tools/coverage-guard.ts'
import type { PriorEventContext } from './follow-up.ts'
import type { SearchEventsInput } from '../tools/search-events.ts'

export interface OrchestrateInput {
  requestId: string
  modelMessages: ModelMessage[]
  userContext: UserToolContext
  locale: 'en' | 'es'
  systemPrompt: string
  originalQuery: string
  priorDisplayedEvents: PriorEventContext[]
  pinnedEventId?: string
  pinnedEventName?: string
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
 * FINAL relevant read — not the last search. A final list_saved_events read
 * allows up to min(returned events, 5) even when no search ran or an earlier
 * search was limit-1; details/directions/venue stay count 1; a final search
 * uses its actual displayLimit.
 */
function deriveRequestedCount(ledger: Ledger): number {
  const finalRead = ledger.finalRelevantRead()
  if (!finalRead) return 1
  switch (finalRead.kind) {
    case 'search':
      return finalRead.displayLimit ?? finalRead.searchInput?.limit ?? 1
    case 'saved-events':
      return Math.min(finalRead.events.length, 5)
    case 'event-details':
    case 'directions':
    case 'venue-details':
      return 1
    default:
      return 1
  }
}

function deriveSearchContext(ledger: Ledger): {
  requestedCount: number
  mode: Mode
  searchInput: SearchEventsInput | null
} {
  const searches = ledger.successfulSearches()
  const last = searches.at(-1)
  const requestedCount = deriveRequestedCount(ledger)
  const mode: Mode =
    last?.searchInput?.objective === 'surprise'
      ? 'pick'
      : requestedCount > 1
        ? 'discovery'
        : 'other'
  return { requestedCount, mode, searchInput: last?.searchInput ?? null }
}

/** Coverage from the exact selected search provenance only (never later unrelated searches). */
function deriveCoverage(ledger: Ledger, sourceToolCallIds: string[]): CoverageInfo | null {
  const selected = new Set(sourceToolCallIds)
  const searches = ledger.successfulSearches().filter((s) => selected.has(s.toolCallId))
  const source = searches.at(-1)
  return source?.coverage ?? null
}

function materializeCanonical(
  input: OrchestrateInput,
  plan: FinalizerPlan,
  validated: ValidatedPlan
): CanonicalChatResponse {
  return {
    contractVersion: CHAT_CONTRACT_VERSION,
    requestId: input.requestId,
    kind: validated.kind,
    text: plan.text.trim(),
    events: validated.events,
    directions: validated.directions,
    venue: validated.venue,
    operations: validated.operations,
    suggestions: [],
    provenance: {
      sourceToolCallIds: validated.sourceToolCallIds,
      directionToolCallIds: validated.directionToolCallIds,
      venueToolCallIds: validated.venueToolCallIds,
      mutationToolCallIds: validated.mutationToolCallIds,
      suggestionToolCallIds: validated.suggestionToolCallIds,
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

export async function orchestrate(input: OrchestrateInput): Promise<OrchestrateResult> {
  const work = await runWorkLoop({
    requestId: input.requestId,
    modelMessages: input.modelMessages,
    systemPrompt: input.systemPrompt,
    userContext: input.userContext,
    locale: input.locale,
    maxWorkGenerations: input.maxWorkGenerations,
    hooks: input.hooks,
  })

  const { requestedCount, mode } = deriveSearchContext(work.ledger)

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
    pinnedEventName: input.pinnedEventName,
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
      pinnedEventId: input.pinnedEventId,
      requestedCount,
    })

    if (validated.ok) {
      canonical = materializeCanonical(input, plan, validated)
    } else {
      canonical = buildFallback({
        requestId: input.requestId,
        locale: input.locale,
        reason: validated.reason ?? 'invalid_schema',
        ledger: work.ledger,
        requestedCount,
        pinnedEventId: input.pinnedEventId,
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

  // Off-topic / coverage guards run on the finalized canonical response only.
  // Mutation receipts must never be erased by the off-topic classifier: skip
  // the replacement whenever the turn already acknowledged an operation.
  if (canonical.text && !input.pinnedEventId && canonical.operations.length === 0) {
    const guarded = await guardForOffTopic(canonical.text, input.locale, {
      query: input.originalQuery,
      eventNames: canonical.events.map((e) => e.name),
    })
    if (guarded) {
      canonical = {
        ...canonical,
        kind: 'out_of_scope',
        text: guarded,
        events: [],
        directions: null,
        venue: null,
        operations: [],
        suggestions: [],
        provenance: {
          ...canonical.provenance,
          sourceToolCallIds: [],
          directionToolCallIds: [],
          venueToolCallIds: [],
          mutationToolCallIds: [],
          suggestionToolCallIds: [],
        },
      }
    }
  }
  if (canonical.text) {
    canonical.text = guardCoverageClaims(
      canonical.text,
      input.locale,
      deriveCoverage(work.ledger, canonical.provenance.sourceToolCallIds)
    )
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
