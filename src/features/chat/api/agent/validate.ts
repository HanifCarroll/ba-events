/**
 * Deterministic validation of the v5 finalizer plan against the artifact ledger.
 *
 * The model plan is UNTRUSTED. Cards are materialized server-side from
 * validated ids only — never from prose or event-name matching. Any violation
 * yields a typed `FallbackReason` consumed by the deterministic fallback.
 *
 * Core guarantees:
 * - Search sources are validated by stage eligibility: only ACTIVE (latest
 *   stage) or RETAINED (reactivated by the active stage) sources are
 *   selectable; REJECTED and SUPERSEDED sources are rejected with distinct
 *   typed reasons.
 * - Compound siblings (events + related directions + related venue + operations)
 *   are permitted; unrelated directions/venue refs are rejected by identity.
 * - no_results is grounded on exact empty-source ids and rejected when any
 *   selectable search source (active or retained) has events, or a failed-only
 *   stage is the sole grounding.
 * - pinnedEventId is enforced unconditionally.
 * - Tri-state saved (true|false|null) is applied chronologically (latest
 *   check/save/unsave wins).
 * - Mutation receipts are always acknowledged as siblings, even for
 *   clarification/out_of_scope/error primaries.
 */

import type {
  CanonicalChatEventPayload,
  ClarificationKey,
  ClarificationQuestion,
  DirectionsData,
  FallbackReason,
  MessageKey,
  MutationIntent,
  OperationReceipt,
  PlannedMutation,
  ResolvedTurnTarget,
  ResponseKind,
  VenueDetailsData,
} from '#shared/lib/types.ts'
import type { Ledger, LedgerArtifactKind } from './ledger.ts'
import type { FinalizerPlan } from './finalizer.ts'
import { materializeClarificationQuestions, MESSAGE_KEY_KIND } from './materialize.ts'
import { resolveSavedState } from './record.ts'
import { planMutation } from './mutation.ts'
import { resolveAuthorizedScope } from './context.ts'

export interface ValidateOptions {
  requestId: string
  locale: 'en' | 'es'
  /**
   * Concrete query-derived turn target, resolved against the ledger BEFORE
   * validation (authoritative for every event-relative action).
   */
  resolvedTurnTarget: ResolvedTurnTarget
  /** Pinned event id for pinned-enforcement (independent of the turn target). */
  pinnedEventId?: string
  /** The display limit requested by the search (clamped 1..5). */
  requestedCount: number
  /** Prior known saved state per event id (tri-state; absent = unknown). */
  priorSaved?: Record<string, boolean>
  /** Typed mutation intent (action; its target reference is folded into the target). */
  mutationIntent?: MutationIntent
}

export interface ValidatedPlan {
  ok: boolean
  reason?: FallbackReason
  kind: ResponseKind
  messageKey: MessageKey
  events: CanonicalChatEventPayload[]
  sourceToolCallIds: string[]
  directions: DirectionsData | null
  venue: VenueDetailsData | null
  operations: OperationReceipt[]
  suggestionSourceToolCallId: string | null
  directionToolCallIds: string[]
  venueToolCallIds: string[]
  mutationToolCallIds: string[]
  suggestionToolCallIds: string[]
  emptySourceToolCallIds: string[]
  retainedSourceToolCallIds: string[]
  stageIds: string[]
  searchAttemptToolCallIds: string[]
  /** True when a parallel search call failed (partial_success / partial_failure). */
  searchIncomplete: boolean
  clarificationQuestions: ClarificationQuestion[]
  /** Deterministic mutation resolution, derived exactly once here. */
  mutationStatus: 'none' | 'ambiguous' | 'resolved'
  /** The validated mutation to execute (only when mutationStatus === 'resolved'). */
  plannedMutation: PlannedMutation | null
}

/** Kinds whose selections come from successful search artifacts. */
const SEARCH_KINDS: ResponseKind[] = ['recommendations']
/** Kinds whose selections come from get_event_details. */
const DETAILS_KINDS: ResponseKind[] = ['event_details']
/** Kinds whose selections come from list_saved_events. */
const SAVED_KINDS: ResponseKind[] = ['saved_events']

function expectedSourceKind(kind: ResponseKind): LedgerArtifactKind | null {
  if (SEARCH_KINDS.includes(kind)) return 'search'
  if (DETAILS_KINDS.includes(kind)) return 'event-details'
  if (SAVED_KINDS.includes(kind)) return 'saved-events'
  return null
}

/** Kinds that must never carry events/directions/venue (operations are allowed). */
const EMPTY_KINDS: ResponseKind[] = ['clarification', 'out_of_scope', 'error']

function fail(
  reason: FallbackReason,
  kind: ResponseKind,
  messageKey: MessageKey,
  mutationStatus: ValidatedPlan['mutationStatus'] = 'none'
): ValidatedPlan {
  return {
    ok: false,
    reason,
    kind,
    messageKey,
    events: [],
    sourceToolCallIds: [],
    directions: null,
    venue: null,
    operations: [],
    suggestionSourceToolCallId: null,
    directionToolCallIds: [],
    venueToolCallIds: [],
    mutationToolCallIds: [],
    suggestionToolCallIds: [],
    emptySourceToolCallIds: [],
    retainedSourceToolCallIds: [],
    stageIds: [],
    searchAttemptToolCallIds: [],
    searchIncomplete: false,
    clarificationQuestions: [],
    mutationStatus,
    plannedMutation: null,
  }
}

function contributingStageIds(ledger: Ledger, requestId: string, toolCallIds: string[]): string[] {
  const set = new Set(toolCallIds)
  return ledger
    .searchStages(requestId)
    .filter((s) => s.toolCallIds.some((id) => set.has(id)))
    .map((s) => s.stageId)
}

/**
 * The single intended event/venue scope authorized by a turn target (see
 * `resolveAuthorizedScope` in context.ts). Never a union of prior + current ids.
 */

export function validatePlan(
  plan: FinalizerPlan,
  ledger: Ledger,
  options: ValidateOptions
): ValidatedPlan {
  const { requestId, requestedCount, locale, priorSaved, resolvedTurnTarget } = options
  const kind = plan.primaryKind
  const messageKey = plan.messageKey

  // Closed messageKey must match the primary kind.
  if (MESSAGE_KEY_KIND[messageKey] !== kind) {
    return fail('invalid_message_key', kind, messageKey)
  }

  // Clarification questions: bounded (max 2, schema-enforced) and only for
  // the clarification kind. A clarification response must carry at least one
  // fixed question; default to a safe vague-discovery question when the
  // finalizer supplies none (never free prose).
  const clarificationKeys = (plan.clarificationQuestions ?? []).map((q) => q.key)
  if (clarificationKeys.length > 2) return fail('invalid_clarification', kind, messageKey)
  if (kind !== 'clarification' && clarificationKeys.length > 0) {
    return fail('inconsistent_response_kind', kind, messageKey)
  }
  const effectiveKeys: ClarificationKey[] =
    kind === 'clarification' && clarificationKeys.length === 0
      ? ['which_category']
      : clarificationKeys
  const clarificationQuestions =
    kind === 'clarification' ? materializeClarificationQuestions(effectiveKeys, locale) : []

  // Dedupe selections.
  const selections = plan.eventSelections ?? []
  const seen = new Set<string>()
  for (const sel of selections) {
    if (seen.has(sel.eventId)) return fail('duplicate_event_id', kind, messageKey)
    seen.add(sel.eventId)
  }

  // Pinned enforcement (unconditional).
  const pinnedEventId = options.pinnedEventId
  if (pinnedEventId) {
    if (selections.length === 0) {
      // fall through — directions/venue/clarification/no_results/error allowed.
    } else if (
      selections.length === 1 &&
      selections[0].eventId === pinnedEventId &&
      kind === 'event_details'
    ) {
      const src = ledger.find(selections[0].sourceToolCallId)
      if (
        !src ||
        src.requestId !== requestId ||
        src.kind !== 'event-details' ||
        !src.success ||
        !src.events.some((e) => e.id === pinnedEventId)
      ) {
        return fail('pinned_substitution', kind, messageKey)
      }
    } else {
      return fail('pinned_substitution', kind, messageKey)
    }
  }

  // Resolve each selection against the exact source artifact.
  const events: CanonicalChatEventPayload[] = []
  const sourceToolCallIds: string[] = []
  const sourceKind = expectedSourceKind(kind)
  for (const sel of selections) {
    const source = ledger.find(sel.sourceToolCallId)
    if (!source || source.requestId !== requestId || !source.success) {
      return fail('invalid_source_tool_call', kind, messageKey)
    }
    if (sourceKind && source.kind !== sourceKind) {
      return fail('inconsistent_response_kind', kind, messageKey)
    }
    if (source.kind === 'search') {
      const status = ledger.searchSourceStatus(source.toolCallId, requestId)
      if (status === 'rejected') return fail('rejected_source', kind, messageKey)
      if (status !== 'active' && status !== 'retained') {
        return fail('superseded_source', kind, messageKey)
      }
    }
    const event = source.events.find((e) => e.id === sel.eventId)
    if (!event) return fail('unknown_event_id', kind, messageKey)

    const saved = resolveSavedState(event.id, ledger, requestId, priorSaved)
    events.push({ ...event, saved })
    if (!sourceToolCallIds.includes(sel.sourceToolCallId)) {
      sourceToolCallIds.push(sel.sourceToolCallId)
    }
  }

  const limit = Math.max(1, Math.min(requestedCount, 5))
  if (events.length > limit) {
    return fail('over_limit', kind, messageKey)
  }

  // Relation context for compound siblings: allowed event/venue identities.
  // Derived from the SINGLE concrete resolved turn target — never a union of
  // prior + current ids and never the finalizer's eventSelections.
  const allowed = resolveAuthorizedScope(resolvedTurnTarget)
  const allowedEventIds = allowed.eventIds
  const allowedVenueIds = allowed.venueIds

  // Directions reference (compound sibling).
  let directions: DirectionsData | null = null
  const directionToolCallIds: string[] = []
  if (plan.directionsToolCallId != null) {
    const dir = ledger.find(plan.directionsToolCallId)
    if (!dir || dir.requestId !== requestId || dir.kind !== 'directions' || !dir.success || !dir.directions) {
      return fail('invalid_directions_ref', kind, messageKey)
    }
    const d = dir.directions
    const related =
      (typeof d.eventId === 'string' && d.eventId && allowedEventIds.has(d.eventId)) ||
      (typeof d.venueId === 'string' && d.venueId && allowedVenueIds.has(d.venueId))
    if (!related) return fail('unrelated_directions_ref', kind, messageKey)
    directions = d
    directionToolCallIds.push(dir.toolCallId)
  }

  // Venue reference (compound sibling).
  let venue: VenueDetailsData | null = null
  const venueToolCallIds: string[] = []
  if (plan.venueToolCallId != null) {
    const v = ledger.find(plan.venueToolCallId)
    if (!v || v.requestId !== requestId || v.kind !== 'venue-details' || !v.success || !v.venue) {
      return fail('invalid_venue_ref', kind, messageKey)
    }
    const related = typeof v.venue.venueId === 'string' && !!v.venue.venueId && allowedVenueIds.has(v.venue.venueId)
    if (!related) return fail('unrelated_venue_ref', kind, messageKey)
    venue = v.venue
    venueToolCallIds.push(v.toolCallId)
  }

  // Post-plan mutation planning (derived exactly once here; the assemble step
  // executes the carried `plannedMutation` without re-planning). The finalizer
  // proposal is cross-checked against the deterministic target; a conflicting or
  // omitted proposal is rejected before any side effect.
  const proposedMutations = plan.plannedMutations ?? []
  const intent =
    options.mutationIntent && options.mutationIntent.kind !== 'none'
      ? options.mutationIntent
      : ({ kind: 'none' as const })
  const deterministic = planMutation({
    intent,
    resolvedTurnTarget,
  })

  let mutationStatus: 'none' | 'ambiguous' | 'resolved'
  let plannedMutation: PlannedMutation | null = null

  if (deterministic.status === 'none') {
    // No mutation intent: plannedMutations must be exactly empty.
    if (proposedMutations.length > 0) {
      return fail('mutation_target_mismatch', kind, messageKey)
    }
    mutationStatus = 'none'
  } else if (deterministic.status === 'ambiguous') {
    // Ambiguous target: zero mutation (a clarification response is assembled
    // downstream), never a side effect and never a proposed mutation.
    if (proposedMutations.length > 0) {
      return fail('ambiguous_mutation_target', kind, messageKey, 'ambiguous')
    }
    mutationStatus = 'ambiguous'
  } else {
    // Resolved: exactly one proposal exactly matching the deterministic plan.
    if (proposedMutations.length !== 1) {
      return fail('mutation_target_mismatch', kind, messageKey)
    }
    const proposed = proposedMutations[0]
    const decided = deterministic.planned
    const proposedSourceToolCallId =
      proposed.source.kind === 'selected_current_event'
        ? proposed.source.sourceToolCallId ?? ''
        : undefined
    const decidedSourceToolCallId =
      decided.source.kind === 'selected_current_event'
        ? decided.source.sourceToolCallId
        : undefined
    if (
      proposed.action !== decided.action ||
      proposed.eventId !== decided.eventId ||
      proposed.source.kind !== decided.source.kind ||
      proposedSourceToolCallId !== decidedSourceToolCallId
    ) {
      return fail('mutation_target_mismatch', kind, messageKey)
    }
    plannedMutation = decided
    mutationStatus = 'resolved'
  }

  // event_details selections are authorized by the SAME turn-target scope as
  // directions/venue: a prior/pinned target must be the exact selected event,
  // never a substituted get_event_details id. (Pinned enforcement above already
  // covers the pin; this guards the prior-target case and shares the target.)
  // Skipped when the mutation target is ambiguous: the assemble step recovers
  // that plan to a zero-side-effect clarification regardless of the read.
  if (DETAILS_KINDS.includes(kind) && events.length === 1 && mutationStatus !== 'ambiguous') {
    if (!allowedEventIds.has(events[0].id)) {
      return fail('unrelated_event_details_ref', kind, messageKey)
    }
  }

  // Suggestion source: a search source that actually produced a selected event.
  let suggestionSourceToolCallId: string | null = null
  if (plan.suggestionSourceToolCallId != null) {
    const src = ledger.find(plan.suggestionSourceToolCallId)
    if (!src || src.requestId !== requestId || !src.success || src.kind !== 'search') {
      return fail('invalid_source_tool_call', kind, messageKey)
    }
    const status = ledger.searchSourceStatus(src.toolCallId, requestId)
    if (status === 'rejected') return fail('rejected_source', kind, messageKey)
    if (status !== 'active' && status !== 'retained') {
      return fail('superseded_source', kind, messageKey)
    }
    const relevant = events.some((e) => src.eventIds.includes(e.id))
    if (!relevant) return fail('invalid_source_tool_call', kind, messageKey)
    suggestionSourceToolCallId = src.toolCallId
  }

  // no_results grounding: exact empty-source ids only; reject when any
  // selectable search source (active or retained) has events.
  const emptySourceToolCallIds: string[] = []
  if (kind === 'no_results') {
    const emptyIds = plan.emptySourceToolCallIds ?? []
    if (emptyIds.length === 0) return fail('invalid_empty_source', kind, messageKey)

    const active = ledger.activeStage(requestId)
    if (
      active &&
      active.eligibility === 'active' &&
      (active.outcome === 'success' ||
        active.outcome === 'partial_success' ||
        active.outcome === 'partial_failure')
    ) {
      return fail('no_results', kind, messageKey)
    }
    for (const id of ledger.retainedSearchToolCallIds(requestId)) {
      const r = ledger.find(id)
      if (r && r.success && r.events.length > 0) {
        return fail('no_results', kind, messageKey)
      }
    }

    for (const id of emptyIds) {
      const entry = ledger.find(id)
      if (!entry || entry.requestId !== requestId || !entry.success) {
        return fail('invalid_empty_source', kind, messageKey)
      }
      const emptySearch =
        entry.kind === 'search' &&
        entry.zeroResults &&
        ledger.searchSourceStatus(entry.toolCallId, requestId) === 'active'
      const emptySaved = entry.kind === 'saved-events' && entry.zeroResults
      if (!emptySearch && !emptySaved) {
        return fail('invalid_empty_source', kind, messageKey)
      }
      if (!emptySourceToolCallIds.includes(id)) emptySourceToolCallIds.push(id)
    }
  }

  // Kind / artifact consistency (compound-aware; operations always allowed as
  // siblings, including on clarification/out_of_scope/error).
  const carriesDisplayArtifacts = events.length > 0 || directions !== null || venue !== null

  if (EMPTY_KINDS.includes(kind) && carriesDisplayArtifacts) {
    return fail('inconsistent_response_kind', kind, messageKey)
  }

  if (kind === 'no_results' && (events.length > 0 || directions !== null || venue !== null)) {
    return fail('inconsistent_response_kind', kind, messageKey)
  }

  if (SEARCH_KINDS.includes(kind) || SAVED_KINDS.includes(kind)) {
    if (events.length === 0) return fail('missing_required_artifact', kind, messageKey)
  }

  if (DETAILS_KINDS.includes(kind)) {
    if (events.length !== 1) return fail('inconsistent_response_kind', kind, messageKey)
  }

  if (kind === 'directions') {
    if (!directions) return fail('missing_required_artifact', kind, messageKey)
    if (events.length > 0 || venue !== null) return fail('inconsistent_response_kind', kind, messageKey)
  }

  if (kind === 'venue_details') {
    if (!venue) return fail('missing_required_artifact', kind, messageKey)
    if (events.length > 0 || directions !== null) return fail('inconsistent_response_kind', kind, messageKey)
  }

  if (kind === 'mutation_result') {
    if (carriesDisplayArtifacts) return fail('inconsistent_response_kind', kind, messageKey)
    // mutation_result is invalid unless a mutation is actually planned.
    if (mutationStatus !== 'resolved') {
      return fail('invalid_mutation_ref', kind, messageKey, mutationStatus)
    }
  }

  // Provenance: retained sources that contributed, plus their stage ids and the
  // latest search-attempt tool call ids (success, empty, or failed).
  const retainedSet = new Set(ledger.retainedSearchToolCallIds(requestId))
  const retainedSourceToolCallIds = sourceToolCallIds.filter((id) => retainedSet.has(id))
  const stageIds = contributingStageIds(ledger, requestId, [
    ...sourceToolCallIds,
    ...emptySourceToolCallIds,
  ])
  const activeStage = ledger.activeStage(requestId)
  const searchAttemptToolCallIds = activeStage?.toolCallIds ?? []
  const searchIncomplete =
    activeStage?.outcome === 'partial_success' || activeStage?.outcome === 'partial_failure'

  return {
    ok: true,
    kind,
    messageKey,
    events,
    sourceToolCallIds,
    directions,
    venue,
    operations: [],
    suggestionSourceToolCallId,
    directionToolCallIds,
    venueToolCallIds,
    mutationToolCallIds: [],
    suggestionToolCallIds: suggestionSourceToolCallId ? [suggestionSourceToolCallId] : [],
    emptySourceToolCallIds,
    retainedSourceToolCallIds,
    stageIds,
    searchAttemptToolCallIds,
    searchIncomplete,
    clarificationQuestions,
    mutationStatus,
    plannedMutation,
  }
}
