/**
 * Deterministic validation of the finalizer plan against the artifact ledger.
 *
 * The model plan is UNTRUSTED. Cards are materialized server-side from
 * validated ids only — never from prose or event-name matching. Any violation
 * yields a typed `FallbackReason` consumed by the deterministic fallback.
 *
 * Mutation receipts are acknowledged exactly once: the complete deduped set of
 * current-request mutation receipts is materialized here, never trusted from
 * the model's `operationToolCallIds`.
 */

import type {
  ChatEventPayload,
  DirectionsData,
  FallbackReason,
  OperationReceipt,
  ResponseKind,
  VenueDetailsData,
} from '#shared/lib/types.ts'
import type { Ledger, LedgerArtifactKind } from './ledger.ts'
import type { FinalizerPlan } from './finalizer.ts'

export interface ValidateOptions {
  requestId: string
  pinnedEventId?: string
  /** The display limit requested by the search (clamped 1..5). */
  requestedCount: number
}

export interface ValidatedPlan {
  ok: boolean
  reason?: FallbackReason
  kind: ResponseKind
  events: ChatEventPayload[]
  sourceToolCallIds: string[]
  directions: DirectionsData | null
  venue: VenueDetailsData | null
  operations: OperationReceipt[]
  suggestionSourceToolCallId: string | null
  directionToolCallIds: string[]
  venueToolCallIds: string[]
  mutationToolCallIds: string[]
  suggestionToolCallIds: string[]
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

/** Kinds that must never carry events/directions/venue or operations. */
const EMPTY_KINDS: ResponseKind[] = ['clarification', 'out_of_scope', 'error']

function fail(reason: FallbackReason, kind: ResponseKind): ValidatedPlan {
  return {
    ok: false,
    reason,
    kind,
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
  }
}

export function validatePlan(
  plan: FinalizerPlan,
  ledger: Ledger,
  options: ValidateOptions
): ValidatedPlan {
  const { requestId, pinnedEventId, requestedCount } = options

  if (!plan.text || !plan.text.trim()) {
    return fail('empty_text', plan.kind)
  }

  const selections = plan.eventSelections ?? []
  const seen = new Set<string>()
  for (const sel of selections) {
    if (seen.has(sel.eventId)) {
      return fail('duplicate_event_id', plan.kind)
    }
    seen.add(sel.eventId)
  }

  // Resolve each selection against the exact source artifact.
  const events: ChatEventPayload[] = []
  const sourceToolCallIds: string[] = []
  const sourceKind = expectedSourceKind(plan.kind)
  for (const sel of selections) {
    const source = ledger.find(sel.sourceToolCallId)
    if (!source || source.requestId !== requestId || !source.success) {
      return fail('invalid_source_tool_call', plan.kind)
    }
    if (sourceKind && source.kind !== sourceKind) {
      return fail('inconsistent_response_kind', plan.kind)
    }
    const event = source.events.find((e) => e.id === sel.eventId)
    if (!event) {
      return fail('unknown_event_id', plan.kind)
    }
    events.push(event)
    if (!sourceToolCallIds.includes(sel.sourceToolCallId)) {
      sourceToolCallIds.push(sel.sourceToolCallId)
    }
  }

  const limit = Math.max(1, Math.min(requestedCount, 5))
  if (events.length > limit) {
    return fail('over_limit', plan.kind)
  }

  // Pinned event can never be substituted. If a pinned successful details
  // artifact exists, a plan that omits/replaces it is invalid.
  if (pinnedEventId && ledger.eventDetailsFor(pinnedEventId, requestId)) {
    if (!events.some((e) => e.id === pinnedEventId)) {
      return fail('pinned_substitution', plan.kind)
    }
  }

  // Directions reference.
  let directions: DirectionsData | null = null
  const directionToolCallIds: string[] = []
  if (plan.directionsToolCallId != null) {
    const dir = ledger.find(plan.directionsToolCallId)
    if (!dir || dir.requestId !== requestId || !dir.success || !dir.directions) {
      return fail('invalid_directions_ref', plan.kind)
    }
    directions = dir.directions
    directionToolCallIds.push(dir.toolCallId)
  }

  // Venue reference.
  let venue: VenueDetailsData | null = null
  const venueToolCallIds: string[] = []
  if (plan.venueToolCallId != null) {
    const v = ledger.find(plan.venueToolCallId)
    if (!v || v.requestId !== requestId || !v.success || !v.venue) {
      return fail('invalid_venue_ref', plan.kind)
    }
    venue = v.venue
    venueToolCallIds.push(v.toolCallId)
  }

  // Mutation receipts: validate the model's refs are real, belong to this
  // request, and carry a typed receipt — but materialize the COMPLETE deduped
  // set so no receipt (including failed/unauthenticated ones) is ever silently
  // omitted.
  for (const toolCallId of plan.operationToolCallIds ?? []) {
    const entry = ledger.find(toolCallId)
    if (
      !entry ||
      entry.kind !== 'mutation' ||
      !entry.receipt ||
      entry.requestId !== requestId
    ) {
      return fail('invalid_mutation_ref', plan.kind)
    }
  }
  const operations = ledger.mutationReceipts(requestId)
  const mutationToolCallIds = ledger.mutationToolCallIds(requestId)

  // Suggestion source: must be a successful current-request search artifact AND
  // relevant to the displayed events (or the no_results source). An unrelated
  // ref is a model violation, not something to silently neutralize.
  let suggestionSourceToolCallId: string | null = null
  if (plan.suggestionSourceToolCallId != null) {
    const src = ledger.find(plan.suggestionSourceToolCallId)
    if (!src || src.requestId !== requestId || !src.success || src.kind !== 'search') {
      return fail('invalid_source_tool_call', plan.kind)
    }
    const relevant =
      events.some((e) => src.eventIds.includes(e.id)) ||
      (plan.kind === 'no_results' && src.zeroResults)
    if (!relevant) return fail('invalid_source_tool_call', plan.kind)
    suggestionSourceToolCallId = src.toolCallId
  }

  // Kind / artifact consistency.
  const kind = plan.kind
  const carriesDisplayArtifacts =
    events.length > 0 || directions !== null || venue !== null

  if (EMPTY_KINDS.includes(kind) && (carriesDisplayArtifacts || operations.length > 0)) {
    return fail('inconsistent_response_kind', kind)
  }

  // no_results may carry operation receipts (a compound empty-search + save),
  // but never events/directions/venue.
  if (kind === 'no_results' && carriesDisplayArtifacts) {
    return fail('inconsistent_response_kind', kind)
  }

  if (SEARCH_KINDS.includes(kind) || SAVED_KINDS.includes(kind)) {
    if (events.length === 0) return fail('missing_required_artifact', kind)
    if (directions !== null || venue !== null) return fail('inconsistent_response_kind', kind)
  }

  if (DETAILS_KINDS.includes(kind)) {
    if (events.length !== 1) return fail('inconsistent_response_kind', kind)
    if (directions !== null || venue !== null) return fail('inconsistent_response_kind', kind)
  }

  if (kind === 'directions') {
    if (!directions) return fail('missing_required_artifact', kind)
    if (events.length > 0 || venue !== null) return fail('inconsistent_response_kind', kind)
  }

  if (kind === 'venue_details') {
    if (!venue) return fail('missing_required_artifact', kind)
    if (events.length > 0 || directions !== null) return fail('inconsistent_response_kind', kind)
  }

  if (kind === 'mutation_result') {
    if (operations.length === 0) return fail('missing_required_artifact', kind)
    if (carriesDisplayArtifacts) return fail('inconsistent_response_kind', kind)
  }

  return {
    ok: true,
    kind,
    events,
    sourceToolCallIds,
    directions,
    venue,
    operations,
    suggestionSourceToolCallId,
    directionToolCallIds,
    venueToolCallIds,
    mutationToolCallIds,
    suggestionToolCallIds: suggestionSourceToolCallId ? [suggestionSourceToolCallId] : [],
  }
}
