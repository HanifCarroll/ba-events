/**
 * Deterministic typed fallbacks (v5).
 *
 * When the finalizer plan fails validation (or the finalizer errors), the
 * fallback derives a safe canonical response directly from the artifact ledger.
 * Text is materialized deterministically from a closed messageKey — never from
 * model prose. The primary events source is the latest events-bearing read
 * (search stage semantics for discovery, saved-events, or event-details);
 * directions/venue/operations are compound SIBLINGS attached only when their
 * identity ties to a selected/pinned/resolved target — never a last-read-wins
 * primary replacement and never a union of unrelated reads. Mutation receipts
 * are preserved as siblings and never retried.
 */

import type {
  CanonicalChatEventPayload,
  CanonicalChatResponse,
  ChatEventPayload,
  DirectionsData,
  FallbackReason,
  MessageKey,
  OperationReceipt,
  ResponseKind,
  TurnTarget,
  VenueDetailsData,
} from '#shared/lib/types.ts'
import { CHAT_CONTRACT_VERSION } from '#shared/lib/types.ts'
import type { Ledger, LedgerEntry } from './ledger.ts'
import { materializeText } from './materialize.ts'
import { resolveSavedState } from './record.ts'
import { resolveAuthorizedScope } from './context.ts'

export interface FallbackInput {
  requestId: string
  locale: 'en' | 'es'
  reason: FallbackReason
  ledger: Ledger
  requestedCount: number
  /** Query-derived turn target (authoritative for every event-relative artifact). */
  turnTarget: TurnTarget
  pinnedEventId?: string
  /** The pin's known venue id (from PinResolution), authoritative without details. */
  pinnedVenueId?: string
  priorSaved?: Record<string, boolean>
}

interface PrimaryContent {
  kind: ResponseKind
  messageKey: MessageKey
  events: CanonicalChatEventPayload[]
  sourceToolCallIds: string[]
  emptySourceToolCallIds: string[]
  retainedSourceToolCallIds: string[]
  stageIds: string[]
  searchIncomplete: boolean
}

interface DerivedContent {
  kind: ResponseKind
  messageKey: MessageKey
  events: CanonicalChatEventPayload[]
  directions: DirectionsData | null
  venue: VenueDetailsData | null
  operations: OperationReceipt[]
  sourceToolCallIds: string[]
  directionToolCallIds: string[]
  venueToolCallIds: string[]
  emptySourceToolCallIds: string[]
  retainedSourceToolCallIds: string[]
  stageIds: string[]
  searchAttemptToolCallIds: string[]
  searchIncomplete: boolean
}

function clampCap(requestedCount: number): number {
  return Math.max(1, Math.min(requestedCount, 5))
}

function dedupeInOrder(items: CanonicalChatEventPayload[], cap: number): CanonicalChatEventPayload[] {
  const seen = new Set<string>()
  const out: CanonicalChatEventPayload[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    if (out.length >= cap) break
    seen.add(item.id)
    out.push(item)
  }
  return out
}

function latestEventRead(ledger: Ledger, requestId: string): LedgerEntry | null {
  const reads = ledger.successfulEventReads(requestId)
  if (reads.length === 0) return null
  return reads.reduce((best, e) =>
    e.stepIndex > best.stepIndex ||
    (e.stepIndex === best.stepIndex && e.callIndex > best.callIndex)
      ? e
      : best
  )
}

function contributingStageIds(ledger: Ledger, requestId: string, toolCallIds: string[]): string[] {
  const set = new Set(toolCallIds)
  return ledger
    .searchStages(requestId)
    .filter((s) => s.toolCallIds.some((id) => set.has(id)))
    .map((s) => s.stageId)
}

function withSaved(
  event: ChatEventPayload,
  ledger: Ledger,
  requestId: string,
  priorSaved: Record<string, boolean> | undefined
): CanonicalChatEventPayload {
  const saved = resolveSavedState(event.id, ledger, requestId, priorSaved)
  return { ...event, saved }
}

/** Search-primary content: active stage + explicitly retained sources. */
function searchPrimary(
  ledger: Ledger,
  requestId: string,
  cap: number,
  priorSaved: Record<string, boolean> | undefined
): PrimaryContent {
  const active = ledger.activeStage(requestId)
  // A rejected latest stage is not eligible: zero cards, no no_results grounding.
  if (active && active.eligibility === 'rejected') {
    return {
      kind: 'error',
      messageKey: 'error',
      events: [],
      sourceToolCallIds: [],
      emptySourceToolCallIds: [],
      retainedSourceToolCallIds: [],
      stageIds: [active.stageId],
      searchIncomplete: false,
    }
  }
  const retainedIds = ledger.retainedSearchToolCallIds(requestId)
  const activeEntries = active ? ledger.searchesInStep(active.stepIndex, requestId) : []
  const retainedEntries = retainedIds
    .map((id) => ledger.find(id))
    .filter((e): e is LedgerEntry => !!e && e.kind === 'search' && e.success)
  const entries = [...activeEntries, ...retainedEntries]

  const events = dedupeInOrder(
    entries.flatMap((e) => e.events.map((ev) => withSaved(ev, ledger, requestId, priorSaved))),
    cap
  )

  const partial = active?.outcome === 'partial_success'

  if (events.length > 0) {
    const sourceEntries = entries.filter((e) => e.events.length > 0)
    const pick = events.length === 1 && sourceEntries.some((e) => e.searchInput?.objective === 'surprise')
    return {
      kind: 'recommendations',
      messageKey: partial ? 'partial_results' : pick ? 'recommendations_pick' : 'recommendations',
      events,
      sourceToolCallIds: sourceEntries.map((e) => e.toolCallId),
      emptySourceToolCallIds: [],
      retainedSourceToolCallIds: retainedIds.filter((id) =>
        sourceEntries.some((e) => e.toolCallId === id)
      ),
      stageIds: contributingStageIds(ledger, requestId, sourceEntries.map((e) => e.toolCallId)),
      searchIncomplete: partial,
    }
  }

  // No events: an EMPTY active stage grounds no_results. A partial_failure or
  // failed stage cannot ground no_results and must not resurrect earlier cards.
  if (active && active.outcome === 'empty') {
    const emptyIds = activeEntries.map((e) => e.toolCallId)
    return {
      kind: 'no_results',
      messageKey: 'no_results',
      events: [],
      sourceToolCallIds: [],
      emptySourceToolCallIds: emptyIds,
      retainedSourceToolCallIds: [],
      stageIds: contributingStageIds(ledger, requestId, emptyIds),
      searchIncomplete: false,
    }
  }
  return {
    kind: 'error',
    messageKey: 'error',
    events: [],
    sourceToolCallIds: [],
    emptySourceToolCallIds: [],
    retainedSourceToolCallIds: [],
    stageIds: active ? [active.stageId] : [],
    searchIncomplete: active?.outcome === 'partial_failure',
  }
}

function deriveContent(input: FallbackInput): DerivedContent {
  const { ledger, requestId, requestedCount, pinnedEventId, priorSaved, turnTarget } = input
  const operations = ledger.mutationReceipts(requestId)
  const cap = clampCap(requestedCount)

  const pinnedDetails = pinnedEventId ? ledger.eventDetailsFor(pinnedEventId, requestId) : null
  const pinnedVenueId = input.pinnedVenueId ?? (pinnedDetails?.events[0]?.venue_id ?? null)
  const latest = pinnedEventId ? null : latestEventRead(ledger, requestId)

  // --- Primary events source ---
  let primary: PrimaryContent | null = null

  if (pinnedEventId) {
    if (pinnedDetails && pinnedDetails.events.length > 0) {
      primary = {
        kind: 'event_details',
        messageKey: 'event_details',
        events: [withSaved(pinnedDetails.events[0], ledger, requestId, priorSaved)],
        sourceToolCallIds: [pinnedDetails.toolCallId],
        emptySourceToolCallIds: [],
        retainedSourceToolCallIds: [],
        stageIds: [],
        searchIncomplete: false,
      }
    }
  } else {
    if (latest?.kind === 'search') {
      primary = searchPrimary(ledger, requestId, cap, priorSaved)
    } else if (latest?.kind === 'saved-events') {
      const events = dedupeInOrder(
        latest.events.map((ev) => withSaved(ev, ledger, requestId, priorSaved)),
        cap
      )
      if (events.length > 0) {
        primary = {
          kind: 'saved_events',
          messageKey: 'saved_events',
          events,
          sourceToolCallIds: [latest.toolCallId],
          emptySourceToolCallIds: [],
          retainedSourceToolCallIds: [],
          stageIds: [],
          searchIncomplete: false,
        }
      } else {
        primary = {
          kind: 'no_results',
          messageKey: 'no_results',
          events: [],
          sourceToolCallIds: [],
          emptySourceToolCallIds: [latest.toolCallId],
          retainedSourceToolCallIds: [],
          stageIds: [],
          searchIncomplete: false,
        }
      }
    } else if (latest?.kind === 'event-details') {
      const event = latest.events[0]
      const authorized =
        event &&
        resolveAuthorizedScope(turnTarget, [event], null).eventIds.has(event.id)
      primary = authorized
        ? {
            kind: 'event_details',
            messageKey: 'event_details',
            events: [withSaved(event, ledger, requestId, priorSaved)],
            sourceToolCallIds: [latest.toolCallId],
            emptySourceToolCallIds: [],
            retainedSourceToolCallIds: [],
            stageIds: [],
            searchIncomplete: false,
          }
        : {
            kind: 'error',
            messageKey: 'error',
            events: [],
            sourceToolCallIds: [],
            emptySourceToolCallIds: [],
            retainedSourceToolCallIds: [],
            stageIds: [],
            searchIncomplete: false,
          }
    }
  }

  // --- Relation identity sets for compound siblings (single turn target) ---
  // Derived from the ONE turn target — never a union of prior + current ids.
  const allowed = resolveAuthorizedScope(turnTarget, primary?.events ?? [], pinnedVenueId)
  const allowedEventIds = allowed.eventIds
  const allowedVenueIds = allowed.venueIds

  // --- Compound siblings (attached only when tied to a target identity) ---
  let directions: DirectionsData | null = null
  let directionToolCallIds: string[] = []
  const dirArtifact = ledger.directionsArtifact(requestId)
  if (dirArtifact?.directions) {
    const d = dirArtifact.directions
    const related =
      (typeof d.eventId === 'string' && !!d.eventId && allowedEventIds.has(d.eventId)) ||
      (typeof d.venueId === 'string' && !!d.venueId && allowedVenueIds.has(d.venueId))
    if (related) {
      directions = d
      directionToolCallIds = [dirArtifact.toolCallId]
    }
  }

  let venue: VenueDetailsData | null = null
  let venueToolCallIds: string[] = []
  const venueArtifact = ledger.venueDetailsArtifact(requestId)
  if (venueArtifact?.venue) {
    const v = venueArtifact.venue
    const related = typeof v.venueId === 'string' && !!v.venueId && allowedVenueIds.has(v.venueId)
    if (related) {
      venue = v
      venueToolCallIds = [venueArtifact.toolCallId]
    }
  }

  const searchAttemptToolCallIds = ledger.activeStage(requestId)?.toolCallIds ?? []

  // --- Assemble final kind ---
  if (primary && (primary.events.length > 0 || primary.kind === 'no_results' || primary.kind === 'error')) {
    return {
      kind: primary.kind,
      messageKey: primary.messageKey,
      events: primary.events,
      directions,
      venue,
      operations,
      sourceToolCallIds: primary.sourceToolCallIds,
      directionToolCallIds,
      venueToolCallIds,
      emptySourceToolCallIds: primary.emptySourceToolCallIds,
      retainedSourceToolCallIds: primary.retainedSourceToolCallIds,
      stageIds: primary.stageIds,
      searchAttemptToolCallIds,
      searchIncomplete: primary.searchIncomplete,
    }
  }

  // No events source. A directions/venue artifact is a valid primary only when
  // tied to a pinned/resolved target (there is no pureTurn bypass).
  if (directions) {
    return {
      kind: 'directions',
      messageKey: 'directions',
      events: [],
      directions,
      venue: null,
      operations,
      sourceToolCallIds: [],
      directionToolCallIds,
      venueToolCallIds: [],
      emptySourceToolCallIds: [],
      retainedSourceToolCallIds: [],
      stageIds: [],
      searchAttemptToolCallIds,
      searchIncomplete: false,
    }
  }
  if (venue) {
    return {
      kind: 'venue_details',
      messageKey: 'venue_details',
      events: [],
      directions: null,
      venue,
      operations,
      sourceToolCallIds: [],
      directionToolCallIds: [],
      venueToolCallIds,
      emptySourceToolCallIds: [],
      retainedSourceToolCallIds: [],
      stageIds: [],
      searchAttemptToolCallIds,
      searchIncomplete: false,
    }
  }
  return {
    kind: 'error',
    messageKey: 'error',
    events: [],
    directions: null,
    venue: null,
    operations,
    sourceToolCallIds: [],
    directionToolCallIds: [],
    venueToolCallIds: [],
    emptySourceToolCallIds: [],
    retainedSourceToolCallIds: [],
    stageIds: [],
    searchAttemptToolCallIds,
    searchIncomplete: false,
  }
}

export function buildFallback(input: FallbackInput): CanonicalChatResponse {
  const content = deriveContent(input)
  const mutationToolCallIds = input.ledger.mutationToolCallIds(input.requestId)
  const text = materializeText({
    messageKey: content.messageKey,
    locale: input.locale,
    eventName: content.events[0]?.name,
    directionsVenueName: content.directions?.venueName,
    venueName: content.venue?.venueName,
  })

  return {
    contractVersion: CHAT_CONTRACT_VERSION,
    requestId: input.requestId,
    kind: content.kind,
    messageKey: content.messageKey,
    text,
    events: content.events,
    directions: content.directions,
    venue: content.venue,
    operations: content.operations,
    suggestions: [],
    clarificationQuestions: [],
    provenance: {
      sourceToolCallIds: content.sourceToolCallIds,
      directionToolCallIds: content.directionToolCallIds,
      venueToolCallIds: content.venueToolCallIds,
      mutationToolCallIds,
      suggestionToolCallIds: [],
      emptySourceToolCallIds: content.emptySourceToolCallIds,
      retainedSourceToolCallIds: content.retainedSourceToolCallIds,
      stageIds: content.stageIds,
      searchAttemptToolCallIds: content.searchAttemptToolCallIds,
      searchIncomplete: content.searchIncomplete,
      origin: 'fallback',
      fallbackUsed: true,
      fallbackReason: input.reason,
    },
  }
}
