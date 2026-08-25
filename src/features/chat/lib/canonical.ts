/**
 * Version-aware canonical read adapters (v5).
 *
 * Stored assistant messages can hold four historical shapes:
 *   - v2: legacy rows with `visible_content` + loose `attached_data`
 *         (`events` / `suggestions` / `directions`) and no canonical.
 *   - v3: `attached_data.canonical` holding the v3 canonical shape.
 *   - v4: `attached_data.canonical` holding the v4 canonical (pre-outcome-aware
 *         mutation leads, pre-`searchIncomplete` provenance).
 *   - v5: `attached_data.canonical` holding the current canonical, verbatim.
 *
 * These adapters are NON-DESTRUCTIVE: historical rows are never rewritten.
 * They produce a single strict v5 render shape consumed uniformly by the chat
 * UI and follow-up context. Provenance for anything reconstructed from legacy
 * rows is `legacy_unknown` with empty tool-call arrays; `saved` is null where
 * the historical row cannot prove it, and direction/venue identity that was
 * never persisted stays absent. Malformed or unknown-version canonicals are
 * rejected safely (never cast as v5) by falling back to the legacy adapter.
 */

import {
  CHAT_CONTRACT_VERSION,
  CLARIFICATION_KEYS,
  FALLBACK_REASONS,
  LEGACY_MUTATION_RESULT_KEY,
  MESSAGE_KEYS,
  type CanonicalChatEventPayload,
  type CanonicalChatResponse,
  type CanonicalProvenance,
  type ChatEventPayload,
  type ClarificationQuestion,
  type DirectionsData,
  type FallbackReason,
  type MessageAttachedData,
  type MessageKey,
  type MutationOutcome,
  type OperationReceipt,
  type RefinementSuggestion,
  type ResponseKind,
  type VenueDetailsData,
} from '#shared/lib/types.ts'
import { extractRecommendationFraming, type RecommendationFraming } from '#shared/lib/recommendation-framing.ts'

const CONTRACT_VERSION_V4 = 4
const CONTRACT_VERSION_V3 = 3

const RESPONSE_KINDS: readonly ResponseKind[] = [
  'recommendations',
  'event_details',
  'saved_events',
  'directions',
  'venue_details',
  'mutation_result',
  'clarification',
  'no_results',
  'out_of_scope',
  'error',
]

const MUTATION_OUTCOMES: readonly MutationOutcome[] = [
  'applied',
  'already_applied',
  'denied',
  'unauthenticated',
  'not_found',
  'failed',
]

/** The v4 message keys (superset minus the v5 outcome-aware mutation keys). */
const V4_MESSAGE_KEYS: readonly string[] = [
  'recommendations',
  'recommendations_pick',
  'event_details',
  'saved_events',
  'directions',
  'venue_details',
  'mutation_result',
  'clarification',
  'no_results',
  'out_of_scope',
  'share_guidance',
  'error',
]

/** Deterministic messageKey for a legacy-adapted kind (no free-text ambiguity). */
const MESSAGE_KEY_BY_KIND: Record<ResponseKind, MessageKey> = {
  recommendations: 'recommendations',
  event_details: 'event_details',
  saved_events: 'saved_events',
  directions: 'directions',
  venue_details: 'venue_details',
  mutation_result: 'mutation_mixed',
  clarification: 'clarification',
  no_results: 'no_results',
  out_of_scope: 'out_of_scope',
  error: 'error',
}

// ============================================================================
// RUNTIME GUARDS (storage is `unknown` JSON — never cast it as v5)
// ============================================================================

function isObject(data: unknown): data is Record<string, unknown> {
  return data !== null && typeof data === 'object' && !Array.isArray(data)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isResponseKind(value: unknown): value is ResponseKind {
  return typeof value === 'string' && (RESPONSE_KINDS as readonly string[]).includes(value)
}

function isMessageKey(value: unknown): value is MessageKey {
  return typeof value === 'string' && (MESSAGE_KEYS as readonly string[]).includes(value)
}

function isV4MessageKey(value: unknown): boolean {
  return typeof value === 'string' && (V4_MESSAGE_KEYS as readonly string[]).includes(value)
}

function isMutationOutcome(value: unknown): value is MutationOutcome {
  return typeof value === 'string' && (MUTATION_OUTCOMES as readonly string[]).includes(value)
}

function isEventPayload(value: unknown): value is ChatEventPayload {
  return isObject(value) && typeof value.id === 'string' && typeof value.name === 'string'
}

function isCanonicalEvent(value: unknown): value is CanonicalChatEventPayload {
  if (!isEventPayload(value)) return false
  return value.saved === true || value.saved === false || value.saved === null
}

function isDirectionsData(value: unknown): value is DirectionsData {
  if (!isObject(value)) return false
  return (
    typeof (value as { venueName?: unknown }).venueName === 'string' &&
    typeof (value as { address?: unknown }).address === 'string' &&
    typeof (value as { mapsUrl?: unknown }).mapsUrl === 'string'
  )
}

function isVenueDetailsData(value: unknown): value is VenueDetailsData {
  return isObject(value) && typeof (value as { venueName?: unknown }).venueName === 'string'
}

function isOperationReceipt(value: unknown): value is OperationReceipt {
  if (!isObject(value)) return false
  const toolName = value.toolName
  return (
    typeof value.toolCallId === 'string' &&
    (toolName === 'save_event' || toolName === 'unsave_event') &&
    typeof value.eventId === 'string' &&
    isMutationOutcome(value.outcome) &&
    typeof value.message === 'string'
  )
}

function isRefinementSuggestion(value: unknown): value is RefinementSuggestion {
  return (
    isObject(value) &&
    typeof (value as { id?: unknown }).id === 'string' &&
    typeof (value as { label?: unknown }).label === 'string'
  )
}

function isClarificationQuestion(value: unknown): value is ClarificationQuestion {
  if (!isObject(value)) return false
  const key = (value as { key?: unknown }).key
  return (
    typeof key === 'string' &&
    (CLARIFICATION_KEYS as readonly string[]).includes(key) &&
    typeof (value as { label?: unknown }).label === 'string'
  )
}

/** v5 provenance guard: requires the `searchIncomplete` marker. */
function isProvenance(value: unknown): value is CanonicalProvenance {
  if (!isObject(value)) return false
  return (
    isStringArray(value.sourceToolCallIds) &&
    isStringArray(value.directionToolCallIds) &&
    isStringArray(value.venueToolCallIds) &&
    isStringArray(value.mutationToolCallIds) &&
    isStringArray(value.suggestionToolCallIds) &&
    isStringArray(value.emptySourceToolCallIds) &&
    isStringArray(value.retainedSourceToolCallIds) &&
    isStringArray(value.stageIds) &&
    isStringArray(value.searchAttemptToolCallIds) &&
    typeof value.searchIncomplete === 'boolean' &&
    (value.origin === 'validated' ||
      value.origin === 'fallback' ||
      value.origin === 'legacy_unknown') &&
    typeof value.fallbackUsed === 'boolean' &&
    (value.fallbackReason === null ||
      (typeof value.fallbackReason === 'string' &&
        (FALLBACK_REASONS as readonly string[]).includes(value.fallbackReason)))
  )
}

/** v4 provenance guard (no `searchIncomplete` field). */
function isV4Provenance(value: unknown): boolean {
  if (!isObject(value)) return false
  return (
    isStringArray(value.sourceToolCallIds) &&
    isStringArray(value.directionToolCallIds) &&
    isStringArray(value.venueToolCallIds) &&
    isStringArray(value.mutationToolCallIds) &&
    isStringArray(value.suggestionToolCallIds) &&
    isStringArray(value.emptySourceToolCallIds) &&
    isStringArray(value.retainedSourceToolCallIds) &&
    isStringArray(value.stageIds) &&
    isStringArray(value.searchAttemptToolCallIds) &&
    (value.origin === 'validated' ||
      value.origin === 'fallback' ||
      value.origin === 'legacy_unknown') &&
    typeof value.fallbackUsed === 'boolean' &&
    (value.fallbackReason === null ||
      (typeof value.fallbackReason === 'string' &&
        (FALLBACK_REASONS as readonly string[]).includes(value.fallbackReason)))
  )
}

/**
 * Structural v5 guard (not a cast): validates contract version, kind, messageKey,
 * text, every event's id/name/saved tri-state, directions/venue, operation
 * outcomes, suggestion basics, clarification shape, and every provenance field.
 * Returns the SAME object reference when valid so v5 round-trips preserve
 * identity.
 */
export function isV5Canonical(data: unknown): data is CanonicalChatResponse {
  if (!isObject(data)) return false
  if (data.contractVersion !== CHAT_CONTRACT_VERSION) return false
  return (
    typeof data.requestId === 'string' &&
    isResponseKind(data.kind) &&
    isMessageKey(data.messageKey) &&
    typeof data.text === 'string' &&
    Array.isArray(data.events) &&
    data.events.every(isCanonicalEvent) &&
    (data.directions === null || isDirectionsData(data.directions)) &&
    (data.venue === null || isVenueDetailsData(data.venue)) &&
    Array.isArray(data.operations) &&
    data.operations.every(isOperationReceipt) &&
    Array.isArray(data.suggestions) &&
    data.suggestions.every(isRefinementSuggestion) &&
    Array.isArray(data.clarificationQuestions) &&
    data.clarificationQuestions.every(isClarificationQuestion) &&
    isProvenance(data.provenance)
  )
}

/** Structural v4 guard for the v4→v5 adapter (pre-outcome-aware keys/provenance). */
export function isV4Canonical(data: unknown): boolean {
  if (!isObject(data)) return false
  if (data.contractVersion !== CONTRACT_VERSION_V4) return false
  return (
    typeof data.requestId === 'string' &&
    isResponseKind(data.kind) &&
    isV4MessageKey(data.messageKey) &&
    typeof data.text === 'string' &&
    Array.isArray(data.events) &&
    data.events.every(isCanonicalEvent) &&
    (data.directions === null || isDirectionsData(data.directions)) &&
    (data.venue === null || isVenueDetailsData(data.venue)) &&
    Array.isArray(data.operations) &&
    data.operations.every(isOperationReceipt) &&
    Array.isArray(data.suggestions) &&
    data.suggestions.every(isRefinementSuggestion) &&
    Array.isArray(data.clarificationQuestions) &&
    data.clarificationQuestions.every(isClarificationQuestion) &&
    isV4Provenance(data.provenance)
  )
}

function runtimeContractVersion(data: unknown): number | null {
  if (!isObject(data)) return null
  const version = data.contractVersion
  return typeof version === 'number' ? version : null
}

// ============================================================================
// LEGACY PROVENANCE
// ============================================================================

function legacyProvenance(): CanonicalProvenance {
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
    origin: 'legacy_unknown',
    fallbackUsed: false,
    fallbackReason: null,
  }
}

function normalizeLegacyEvents(value: unknown): CanonicalChatEventPayload[] {
  if (!Array.isArray(value)) return []
  return value.filter(isEventPayload).map((event) => ({ ...event, saved: null }))
}

// ============================================================================
// ADAPTERS
// ============================================================================

export function deriveLegacyKind(
  attached: MessageAttachedData | undefined,
  text: string
): ResponseKind {
  const events = attached?.events ?? []
  const hasDirections =
    attached?.directions != null && isDirectionsData(attached.directions)
  if (hasDirections) return events.length > 0 ? 'recommendations' : 'directions'
  if (events.length >= 1) return 'recommendations'
  return text.trim() ? 'out_of_scope' : 'no_results'
}

/** v2 legacy rows → v5 render shape. */
export function adaptV2ToCanonical(message: {
  id: string
  visible_content?: string | null
  content?: string | null
  attached_data?: MessageAttachedData | null
}): CanonicalChatResponse {
  const attached = message.attached_data ?? {}
  const text = (message.visible_content ?? message.content ?? '').trim()
  const kind = deriveLegacyKind(attached, text)
  return {
    contractVersion: CHAT_CONTRACT_VERSION,
    requestId: `legacy:${message.id}`,
    kind,
    messageKey: MESSAGE_KEY_BY_KIND[kind],
    text,
    events: normalizeLegacyEvents(attached.events),
    // Runtime-filter loose directions instead of trusting the storage type.
    directions:
      attached.directions != null && isDirectionsData(attached.directions)
        ? attached.directions
        : null,
    venue: null,
    operations: [],
    suggestions: Array.isArray(attached.suggestions)
      ? attached.suggestions.filter(isRefinementSuggestion)
      : [],
    clarificationQuestions: [],
    provenance: legacyProvenance(),
  }
}

/** v3 `attached_data.canonical` → v5 render shape (preserve visual content). */
export function adaptV3ToCanonical(
  data: unknown,
  fallback: { id: string; visible_content?: string | null; content?: string | null }
): CanonicalChatResponse {
  const canonical = isObject(data) ? data : {}
  const text = (
    (typeof canonical.text === 'string' ? canonical.text : '').trim() ||
    (fallback.visible_content ?? fallback.content ?? '').trim()
  )
  const requestId =
    typeof canonical.requestId === 'string' && canonical.requestId.trim()
      ? canonical.requestId.slice(0, 128)
      : `legacy:${fallback.id}`
  const kind = isResponseKind(canonical.kind)
    ? canonical.kind
    : deriveLegacyKind(undefined, text)

  return {
    contractVersion: CHAT_CONTRACT_VERSION,
    requestId,
    kind,
    messageKey: MESSAGE_KEY_BY_KIND[kind],
    text,
    events: normalizeLegacyEvents(canonical.events),
    directions: isDirectionsData(canonical.directions) ? canonical.directions : null,
    venue: isVenueDetailsData(canonical.venue) ? canonical.venue : null,
    operations: Array.isArray(canonical.operations)
      ? canonical.operations.filter(isOperationReceipt)
      : [],
    suggestions: Array.isArray(canonical.suggestions)
      ? canonical.suggestions.filter(isRefinementSuggestion)
      : [],
    clarificationQuestions: [],
    provenance: legacyProvenance(),
  }
}

/**
 * v4 canonical → v5 render shape. Preserves visual content verbatim; maps the
 * legacy `mutation_result` messageKey to the neutral `mutation_mixed` lead, and
 * fills the `searchIncomplete` provenance marker (unreconstructable from v4) as
 * `false`.
 */
export function adaptV4ToCanonical(
  data: unknown,
  fallback: { id: string; visible_content?: string | null; content?: string | null }
): CanonicalChatResponse {
  const canonical = isObject(data) ? data : {}
  const text = (
    (typeof canonical.text === 'string' ? canonical.text : '').trim() ||
    (fallback.visible_content ?? fallback.content ?? '').trim()
  )
  const requestId =
    typeof canonical.requestId === 'string' && canonical.requestId.trim()
      ? canonical.requestId.slice(0, 128)
      : `legacy:${fallback.id}`
  const kind = isResponseKind(canonical.kind)
    ? canonical.kind
    : deriveLegacyKind(undefined, text)

  const rawKey = typeof canonical.messageKey === 'string' ? canonical.messageKey : null
  const messageKey: MessageKey =
    rawKey === LEGACY_MUTATION_RESULT_KEY
      ? 'mutation_mixed'
      : isMessageKey(rawKey)
        ? rawKey
        : MESSAGE_KEY_BY_KIND[kind]

  const rawProvenance = isObject(canonical.provenance) ? canonical.provenance : {}
  const provenance: CanonicalProvenance = {
    sourceToolCallIds: isStringArray(rawProvenance.sourceToolCallIds) ? rawProvenance.sourceToolCallIds : [],
    directionToolCallIds: isStringArray(rawProvenance.directionToolCallIds) ? rawProvenance.directionToolCallIds : [],
    venueToolCallIds: isStringArray(rawProvenance.venueToolCallIds) ? rawProvenance.venueToolCallIds : [],
    mutationToolCallIds: isStringArray(rawProvenance.mutationToolCallIds) ? rawProvenance.mutationToolCallIds : [],
    suggestionToolCallIds: isStringArray(rawProvenance.suggestionToolCallIds) ? rawProvenance.suggestionToolCallIds : [],
    emptySourceToolCallIds: isStringArray(rawProvenance.emptySourceToolCallIds) ? rawProvenance.emptySourceToolCallIds : [],
    retainedSourceToolCallIds: isStringArray(rawProvenance.retainedSourceToolCallIds) ? rawProvenance.retainedSourceToolCallIds : [],
    stageIds: isStringArray(rawProvenance.stageIds) ? rawProvenance.stageIds : [],
    searchAttemptToolCallIds: isStringArray(rawProvenance.searchAttemptToolCallIds) ? rawProvenance.searchAttemptToolCallIds : [],
    searchIncomplete: false,
    origin:
      rawProvenance.origin === 'validated' ||
      rawProvenance.origin === 'fallback' ||
      rawProvenance.origin === 'legacy_unknown'
        ? rawProvenance.origin
        : 'legacy_unknown',
    fallbackUsed: typeof rawProvenance.fallbackUsed === 'boolean' ? rawProvenance.fallbackUsed : false,
    fallbackReason:
      typeof rawProvenance.fallbackReason === 'string' &&
      (FALLBACK_REASONS as readonly string[]).includes(rawProvenance.fallbackReason)
        ? (rawProvenance.fallbackReason as FallbackReason)
        : null,
  }

  return {
    contractVersion: CHAT_CONTRACT_VERSION,
    requestId,
    kind,
    messageKey,
    text,
    events: Array.isArray(canonical.events) ? canonical.events.filter(isCanonicalEvent) : [],
    directions: isDirectionsData(canonical.directions) ? canonical.directions : null,
    venue: isVenueDetailsData(canonical.venue) ? canonical.venue : null,
    operations: Array.isArray(canonical.operations)
      ? canonical.operations.filter(isOperationReceipt)
      : [],
    suggestions: Array.isArray(canonical.suggestions)
      ? canonical.suggestions.filter(isRefinementSuggestion)
      : [],
    clarificationQuestions: Array.isArray(canonical.clarificationQuestions)
      ? canonical.clarificationQuestions.filter(isClarificationQuestion)
      : [],
    provenance,
  }
}

/**
 * The single version-aware reload adapter. Dispatches on the runtime
 * `contractVersion` inside the persisted canonical; the DB
 * `response_contract_version` column is used ONLY as a secondary signal when
 * the runtime version is absent (null/missing). An explicit unknown runtime
 * version is always rejected — never overridden by the column. Rows with no
 * canonical fall back to the legacy v2 path.
 */
export function adaptStoredMessageToCanonical(message: {
  id: string
  response_contract_version?: number | null
  attached_data?: MessageAttachedData | null
  visible_content?: string | null
  content?: string | null
}): CanonicalChatResponse {
  const canonical = message.attached_data?.canonical
  const columnVersion = message.response_contract_version

  if (canonical !== undefined && canonical !== null) {
    const runtime = runtimeContractVersion(canonical)
    if (runtime === CHAT_CONTRACT_VERSION && isV5Canonical(canonical)) {
      return canonical
    }
    if (runtime === CONTRACT_VERSION_V4) {
      return adaptV4ToCanonical(canonical, message)
    }
    if (
      runtime === CONTRACT_VERSION_V3 ||
      (runtime === null && columnVersion === CONTRACT_VERSION_V3)
    ) {
      return adaptV3ToCanonical(canonical, message)
    }
    // Unknown/malformed version inside the canonical payload: reject safely.
    return adaptV2ToCanonical(message)
  }

  return adaptV2ToCanonical(message)
}

/** Renderable fields derived from a canonical v5 response (or adapted legacy). */
export function canonicalToRender(canonical: CanonicalChatResponse): {
  events: CanonicalChatResponse['events']
  suggestions: CanonicalChatResponse['suggestions']
  directions: CanonicalChatResponse['directions']
  venue: CanonicalChatResponse['venue']
  operations: CanonicalChatResponse['operations']
  clarificationQuestions: ClarificationQuestion[]
  framing: RecommendationFraming | null
} {
  const framing = canonical.kind === 'recommendations' && canonical.framing
    ? extractRecommendationFraming(
        `ACK: ${canonical.framing.acknowledgement}\nNEXT: ${canonical.framing.nextStep}`,
        canonical.events,
        canonical.events.map((event) => event.venue_name ?? ''),
      )
    : null
  return {
    events: canonical.events,
    suggestions: canonical.suggestions,
    directions: canonical.directions,
    venue: canonical.venue,
    operations: canonical.operations,
    clarificationQuestions: canonical.clarificationQuestions,
    framing,
  }
}

/** Extract/validate the v5 canonical from a streamed `data-response` part. */
export function canonicalFromDataResponse(data: unknown): CanonicalChatResponse | null {
  return isV5Canonical(data) ? data : null
}
