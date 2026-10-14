/**
 * Grouped follow-up context + untrusted canonical rehydration.
 *
 * Prior displayed events stay grouped by assistant response so the agent can
 * interpret references against the newest displayed list. Historical
 * mutation-only responses create no group and never move the ordinal window.
 *
 * Trust model:
 * - Client `data-response` parts and persisted canonical strings are UNTRUSTED.
 *   `parseDataResponseHint` applies a bounded Effect Schema (v3-v5) and
 *   yields event/operation IDs only — never names.
 * - Rehydration re-fetches those IDs from the database in one bounded query and
 *   discards missing/non-displayable events. Only DB names/venue facts survive.
 *
 * Saved-state authority (v5):
 * - Guest history: client-provided `saved` values and historical operation
 *   outcomes are NOT trusted as saved-state evidence; rehydrated events default
 *   to `null`.
 * - Authenticated history: current saved membership is rehydrated from the
 *   database (one bounded membership query) and is authoritative.
 */

import { Data, Effect, Schema } from 'effect'
import type { UIMessage } from 'ai'
import type {
  EventStatus,
  Message,
  MutationOutcome,
  ResponseKind,
  SavedMembershipResult,
} from '#shared/lib/types.ts'
import { adaptStoredMessageToCanonical } from '#features/chat/lib/canonical.ts'

// ============================================================================
// BOUNDS
// ============================================================================

/** Maximum number of result-bearing groups retained (newest kept). */
export const MAX_PRIOR_GROUPS = 6
/** Maximum total event occurrences retained across all groups. */
export const MAX_PRIOR_EVENTS = 20
/** Maximum number of newest assistant messages inspected for prior context. */
export const MAX_HISTORY_MESSAGES = 50
/** Maximum events accepted in one untrusted data-response hint. */
export const MAX_HINT_EVENTS = 50
/** Maximum operations accepted in one untrusted data-response hint. */
export const MAX_HINT_OPERATIONS = 20
/** Maximum distinct ids submitted to the rehydration query. */
export const MAX_REHYDRATE_IDS = 100
/** Cap for a single accepted string (id, requestId, name). */
export const MAX_ID_STRING = 128
export const MAX_NAME_STRING = 200

/**
 * Event statuses eligible for rehydration. Cancelled/postponed/pending_review
 * events are discarded (they are no longer actionable and must not be offered
 * as follow-up targets). `scheduled` and `past` are allowed, so past events can
 * still be referenced ("tell me about the one we discussed").
 */
export const DISPLAYABLE_EVENT_STATUSES: ReadonlyArray<EventStatus> = [
  'scheduled',
  'past',
]

export function isDisplayableStatus(status: unknown): status is EventStatus {
  return status === 'scheduled' || status === 'past'
}

// ============================================================================
// TYPES
// ============================================================================

export type PriorSaved = boolean | null

// ============================================================================
// STABLE HANDLES
// ============================================================================

/**
 * Server-owned stable handle for a displayed event: `requestId:event_N`.
 * Existing v5 ordered event IDs already persist this mapping (the canonical
 * stores `requestId` + ordered `events`), so no wire bump is needed to address
 * a prior event on a later turn. Handles are never exposed to the model as
 * UUIDs — the agent only ever sees/returns these exact strings.
 */
export function handleFor(requestId: string, index: number): string {
  return `${requestId}:event_${index}`
}

export interface PriorDisplayEvent {
  eventId: string
  /** Original zero-based position in the persisted canonical response. */
  displayIndex: number
  name: string
  saved: PriorSaved
}

export interface PriorDisplayGroup {
  assistantMessageId: string
  requestId: string
  createdAt: string | null
  events: PriorDisplayEvent[]
}

/** Minimal DB fact needed to rehydrate an event for follow-up context. */
export interface EventFact {
  id: string
  name: string
  venue_id: string | null
  venue_name: string | null
  status: EventStatus
}

export type FetchEventFacts = (ids: string[], abortSignal?: AbortSignal) => Promise<EventFact[]>

class PriorContextFetchError extends Data.TaggedError('PriorContextFetchError')<{
  readonly message: string
}> {}

export interface VenueFact {
  venueId: string | null
  venueName: string | null
}

/** Rehydrated prior context: display groups plus per-event venue facts. */
export interface PriorContext {
  groups: PriorDisplayGroup[]
  venueByEventId: Map<string, VenueFact>
}

/** Validated hint extracted from an untrusted data-response / canonical. */
export interface DataResponseHint {
  contractVersion: 3 | 4 | 5
  requestId: string
  kind: ResponseKind
  events: Array<{ eventId: string; saved: PriorSaved }>
  operations: Array<{
    toolName: 'save_event' | 'unsave_event'
    eventId: string
    outcome: MutationOutcome
  }>
}

/** One response's validated hint plus message identity for grouping. */
export interface PriorResponseHint {
  assistantMessageId: string
  createdAt: string | null
  requestId: string
  events: Array<{ eventId: string; saved: PriorSaved }>
  operations: Array<{
    toolName: 'save_event' | 'unsave_event'
    eventId: string
    outcome: MutationOutcome
  }>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function homeHintsFromIds(ids: string[]): PriorResponseHint | null {
  const events = ids
    .filter((id) => UUID_RE.test(id))
    .slice(0, 4)
    .map((eventId) => ({ eventId, saved: null as PriorSaved }))
  if (events.length === 0) return null
  return {
    assistantMessageId: 'home',
    createdAt: null,
    requestId: 'home',
    events,
    operations: [],
  }
}

// ============================================================================
// UNTRUSTED PARSER (v3/v4 hint shapes only; v2 had no data-response)
// ============================================================================

const RESPONSE_KINDS = [
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
] as const satisfies readonly ResponseKind[]

const MUTATION_OUTCOMES = [
  'applied',
  'already_applied',
  'denied',
  'unauthenticated',
  'not_found',
  'failed',
] as const satisfies readonly MutationOutcome[]

const eventId = Schema.String.pipe(Schema.check(Schema.isPattern(UUID_RE)))
const savedSchema = Schema.Union([Schema.Literal(true), Schema.Literal(false), Schema.Null])

const hintEventSchema = Schema.Struct({
  id: eventId,
  saved: Schema.optional(savedSchema),
})

const hintOperationSchema = Schema.Struct({
  toolName: Schema.Literals(['save_event', 'unsave_event']),
  eventId,
  outcome: Schema.Literals(MUTATION_OUTCOMES),
})

/**
 * Bounded Effect schema for an untrusted data-response hint. Unknown fields are
 * stripped (default object behavior); only the validated fields survive.
 * Invalid contract versions, malformed UUID event ids, bad saved values, and
 * oversized arrays/strings are rejected.
 */
export const dataResponseHintSchema = Schema.Struct({
  contractVersion: Schema.Literals([3, 4, 5]),
  requestId: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(MAX_ID_STRING)),
  ),
  kind: Schema.Literals(RESPONSE_KINDS),
  events: Schema.optional(Schema.Array(hintEventSchema).pipe(Schema.check(Schema.isMaxLength(MAX_HINT_EVENTS)))),
  operations: Schema.optional(Schema.Array(hintOperationSchema).pipe(Schema.check(Schema.isMaxLength(MAX_HINT_OPERATIONS)))),
})

export function parseDataResponseHint(data: unknown): DataResponseHint | null {
  const parsed = Schema.decodeUnknownResult(dataResponseHintSchema)(data)
  if (parsed._tag !== 'Success') return null
  const requestId = sanitizeText(parsed.success.requestId, MAX_ID_STRING)
  if (!requestId) return null
  return {
    contractVersion: parsed.success.contractVersion,
    requestId,
    kind: parsed.success.kind,
    events: (parsed.success.events ?? []).map((e) => ({ eventId: e.id, saved: e.saved ?? null })),
    operations: [...(parsed.success.operations ?? [])],
  }
}

// ============================================================================
// SANITIZATION
// ============================================================================

/** Strip control characters, collapse whitespace, and cap a string. */
export function sanitizeText(value: string, max = MAX_NAME_STRING): string {
  const cleaned = value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned
}

// ============================================================================
// HINT EXTRACTION (guest UI messages vs persisted auth messages)
// ============================================================================

/** Extract a bounded ISO/string createdAt from a UI message (metadata first). */
function messageCreatedAt(message: UIMessage): string | null {
  const meta = (message as unknown as { metadata?: { createdAt?: unknown } }).metadata
    ?.createdAt
  const root = (message as unknown as { createdAt?: unknown }).createdAt
  const raw = typeof meta === 'string' ? meta : typeof root === 'string' ? root : null
  if (!raw) return null
  const cleaned = sanitizeText(raw, MAX_ID_STRING)
  return cleaned || null
}

/** Extract validated hints from untrusted guest UI messages (reload-shaped). */
export function hintsFromUIMessages(messages: UIMessage[]): PriorResponseHint[] {
  const out: PriorResponseHint[] = []
  const assistantMessages = messages.filter(
    (m) => (m as { role?: string }).role === 'assistant'
  )
  // Bound the untrusted history BEFORE parsing: only the newest assistant
  // messages are inspected, so a huge forged history cannot manufacture
  // unbounded groups/work.
  for (const message of assistantMessages.slice(-MAX_HISTORY_MESSAGES)) {
    const assistantMessageId = typeof message.id === 'string' ? message.id : ''
    const createdAt = messageCreatedAt(message)
    const parts = (message.parts ?? []) as Array<{ type?: string; data?: unknown }>
    let accepted = false
    for (const part of parts) {
      if (part.type !== 'data-response') continue
      // At most ONE valid data-response per assistant message: a forged message
      // with duplicate canonical parts cannot manufacture extra groups.
      if (accepted) continue
      const hint = parseDataResponseHint(part.data)
      if (!hint) continue
      // Empty hints (no events, no operations) carry no rehydratable content
      // and must not manufacture groups or work.
      if (hint.events.length === 0 && hint.operations.length === 0) continue
      accepted = true
      out.push({
        assistantMessageId,
        createdAt,
        requestId: hint.requestId,
        events: hint.events,
        operations: hint.operations,
      })
    }
  }
  return out
}

/** Extract validated hints from persisted (untrusted) auth message strings. */
export function hintsFromMessages(messages: Message[]): PriorResponseHint[] {
  const out: PriorResponseHint[] = []
  const assistantMessages = messages.filter((m) => m.role === 'assistant')
  for (const message of assistantMessages.slice(-MAX_HISTORY_MESSAGES)) {
    // Same version-aware adapter as rendering: v2/v3 rows are adapted to the
    // v4 shape so their ID hints survive reload. Malformed/unknown canonicals
    // fall back to the legacy v2 adapter and are rejected by the hint parser
    // when no valid event ids remain.
    const canonical = adaptStoredMessageToCanonical(message)
    const hint = parseDataResponseHint(canonical)
    if (!hint) continue
    // A malformed/unknown canonical adapts to a legacy v2 shape with no ids;
    // skip it (empty hints carry no rehydratable content).
    if (hint.events.length === 0 && hint.operations.length === 0) continue
    out.push({
      assistantMessageId: message.id,
      createdAt: message.created_at ?? null,
      requestId: hint.requestId,
      events: hint.events,
      operations: hint.operations,
    })
  }
  return out
}

// ============================================================================
// GROUPING + REHYDRATION
// ============================================================================

/** Deduped event ids across hints (events + operations), bounded. */
export function collectEventIds(responses: PriorResponseHint[]): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const r of responses) {
    for (const e of r.events) {
      if (!seen.has(e.eventId)) {
        seen.add(e.eventId)
        ids.push(e.eventId)
      }
    }
    for (const op of r.operations) {
      if (!seen.has(op.eventId)) {
        seen.add(op.eventId)
        ids.push(op.eventId)
      }
    }
    if (ids.length >= MAX_REHYDRATE_IDS) break
  }
  return ids.slice(0, MAX_REHYDRATE_IDS)
}

/**
 * Build grouped prior context from validated hints + rehydrated DB facts.
 * Pure and deterministic (no DB access).
 *
 * `savedMembership` (authenticated only) is the authoritative saved-state
 * source: a `complete` result stamps absent ids as `saved:false`, while
 * `unavailable` (guest or a failed query) leaves every event `saved:null` and
 * ignores client `saved`/operation outcomes.
 */
export function buildPriorContext(
  responses: PriorResponseHint[],
  facts: EventFact[],
  savedMembership?: SavedMembershipResult
): PriorContext {
  const factsById = new Map<string, EventFact>()
  const venueByEventId = new Map<string, VenueFact>()
  for (const f of facts) {
    if (!isDisplayableStatus(f.status)) continue
    factsById.set(f.id, f)
    venueByEventId.set(f.id, {
      venueId: f.venue_id,
      venueName: f.venue_name ? sanitizeText(f.venue_name) : null,
    })
  }

  const completeSavedIds: Set<string> | null =
    savedMembership?.status === 'complete' ? savedMembership.savedIds : null
  const groups: PriorDisplayGroup[] = []

  for (const r of responses) {
    // Mutation-only / empty responses create no group.
    if (r.events.length === 0) continue

    const events: PriorDisplayEvent[] = []
    for (const [displayIndex, hintEvent] of r.events.entries()) {
      const fact = factsById.get(hintEvent.eventId)
      if (!fact) continue // discard missing / non-displayable without renumbering handles
      events.push({
        eventId: hintEvent.eventId,
        displayIndex,
        name: sanitizeText(fact.name),
        saved: null, // stamped below from authoritative membership only
      })
    }
    if (events.length > 0) {
      groups.push({
        assistantMessageId: r.assistantMessageId,
        requestId: r.requestId,
        createdAt: r.createdAt,
        events,
      })
    }
  }

  // Bound groups: keep the newest.
  let bounded = groups.slice(-MAX_PRIOR_GROUPS)

  // Bound total events: drop oldest events (front of oldest group first).
  let total = bounded.reduce((n, g) => n + g.events.length, 0)
  if (total > MAX_PRIOR_EVENTS) {
    let toDrop = total - MAX_PRIOR_EVENTS
    for (const g of bounded) {
      if (toDrop <= 0) break
      const drop = Math.min(g.events.length, toDrop)
      g.events.splice(0, drop)
      toDrop -= drop
    }
    bounded = bounded.filter((g) => g.events.length > 0)
  }

  // Stamp the final chronological saved state onto every occurrence.
  // A complete membership result is authoritative (absent => false); an
  // unavailable result leaves saved unknown (null).
  for (const g of bounded) {
    for (const ev of g.events) {
      ev.saved = completeSavedIds
        ? completeSavedIds.has(ev.eventId)
          ? true
          : false
        : null
    }
  }

  return { groups: bounded, venueByEventId }
}

/**
 * Rehydrate prior context from validated hints using an injected fetch function
 * (one bounded query). Guest and auth paths share this exact pipeline; the auth
 * path additionally supplies authoritative saved membership.
 */
/** Effect-native bounded rehydration program. */
export function rehydratePriorContextEffect(
  responses: PriorResponseHint[],
  fetchByIds: FetchEventFacts,
  savedMembership?: SavedMembershipResult,
  abortSignal?: AbortSignal,
): Effect.Effect<PriorContext, PriorContextFetchError> {
  const ids = collectEventIds(responses)
  if (ids.length === 0) return Effect.succeed({ groups: [], venueByEventId: new Map() })
  return Effect.map(
    Effect.tryPromise({
      try: (fiberSignal) => fetchByIds(ids, abortSignal ? AbortSignal.any([abortSignal, fiberSignal]) : fiberSignal),
      catch: () => new PriorContextFetchError({ message: 'Failed to rehydrate prior context' }),
    }),
    (facts) => buildPriorContext(responses, facts, savedMembership),
  )
}

/** Promise compatibility adapter retained for direct callers and tests. */
export function rehydratePriorContext(
  responses: PriorResponseHint[],
  fetchByIds: FetchEventFacts,
  savedMembership?: SavedMembershipResult,
  abortSignal?: AbortSignal,
) {
  return Effect.runPromise(rehydratePriorContextEffect(responses, fetchByIds, savedMembership, abortSignal), { signal: abortSignal })
}
