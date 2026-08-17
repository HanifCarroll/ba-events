/**
 * Deterministic typed fallbacks.
 *
 * When the finalizer plan fails validation (or the finalizer errors), the
 * fallback derives a safe canonical response directly from the artifact
 * ledger. The final relevant successful read is determined by
 * `(stepIndex, callIndex)`; if it is a search, only the successful search
 * calls in that (highest relevant) step contribute (call order → result
 * order → dedupe → cap). Saved/details/directions/venue each use only their
 * own final artifact — unrelated read types are never unioned. Mutation
 * receipts are preserved as siblings and never retried.
 */

import type {
  CanonicalChatResponse,
  ChatEventPayload,
  DirectionsData,
  FallbackReason,
  OperationReceipt,
  ResponseKind,
  VenueDetailsData,
} from '#shared/lib/types.ts'
import { CHAT_CONTRACT_VERSION } from '#shared/lib/types.ts'
import type { Ledger } from './ledger.ts'

export interface FallbackInput {
  requestId: string
  locale: 'en' | 'es'
  reason: FallbackReason
  ledger: Ledger
  requestedCount: number
  pinnedEventId?: string
}

interface DerivedContent {
  kind: ResponseKind
  events: ChatEventPayload[]
  directions: DirectionsData | null
  venue: VenueDetailsData | null
  operations: OperationReceipt[]
  sourceToolCallIds: string[]
  directionToolCallIds: string[]
  venueToolCallIds: string[]
}

function clampCap(requestedCount: number): number {
  return Math.max(1, Math.min(requestedCount, 5))
}

/** Deterministic empty result: no card, primary kind depends on mutation siblings. */
function noCardContent(operations: OperationReceipt[]): DerivedContent {
  return {
    kind: operations.length > 0 ? 'mutation_result' : 'error',
    events: [],
    directions: null,
    venue: null,
    operations,
    sourceToolCallIds: [],
    directionToolCallIds: [],
    venueToolCallIds: [],
  }
}

function dedupeInOrder(items: ChatEventPayload[], cap: number): ChatEventPayload[] {
  const seen = new Set<string>()
  const out: ChatEventPayload[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    if (out.length >= cap) break
    seen.add(item.id)
    out.push(item)
  }
  return out
}

function deriveContent(input: FallbackInput): DerivedContent {
  const { ledger, requestedCount, pinnedEventId } = input
  const operations = ledger.mutationReceipts(input.requestId)
  const cap = clampCap(requestedCount)

  // Pinned fallback prefers ONLY the exact pinned get_event_details artifact.
  // If it is missing, show no alternate event.
  if (pinnedEventId) {
    const pinned = ledger.eventDetailsFor(pinnedEventId, input.requestId)
    if (pinned && pinned.events.length > 0) {
      return {
        kind: 'event_details',
        events: pinned.events.slice(0, 1),
        directions: null,
        venue: null,
        operations,
        sourceToolCallIds: [pinned.toolCallId],
        directionToolCallIds: [],
        venueToolCallIds: [],
      }
    }
    return {
      kind: operations.length > 0 ? 'mutation_result' : 'error',
      events: [],
      directions: null,
      venue: null,
      operations,
      sourceToolCallIds: [],
      directionToolCallIds: [],
      venueToolCallIds: [],
    }
  }

  const finalRead = ledger.finalRelevantRead(input.requestId)
  if (finalRead) {
    switch (finalRead.kind) {
      case 'search': {
        // Only the successful search calls in the highest relevant search step
        // contribute — never earlier steps.
        const searches = ledger.searchesInStep(finalRead.stepIndex, input.requestId)
        const events = dedupeInOrder(searches.flatMap((e) => e.events), cap)
        return {
          kind: events.length > 0 ? 'recommendations' : 'no_results',
          events,
          directions: null,
          venue: null,
          operations,
          sourceToolCallIds: searches.map((e) => e.toolCallId),
          directionToolCallIds: [],
          venueToolCallIds: [],
        }
      }
      case 'event-details':
        // A "successful" details artifact that lost its payload must not become
        // an event_details card with no event.
        if (finalRead.events.length === 0) return noCardContent(operations)
        return {
          kind: 'event_details',
          events: finalRead.events.slice(0, 1),
          directions: null,
          venue: null,
          operations,
          sourceToolCallIds: [finalRead.toolCallId],
          directionToolCallIds: [],
          venueToolCallIds: [],
        }
      case 'saved-events': {
        const events = dedupeInOrder(finalRead.events, cap)
        return {
          kind: events.length > 0 ? 'saved_events' : 'no_results',
          events,
          directions: null,
          venue: null,
          operations,
          sourceToolCallIds: [finalRead.toolCallId],
          directionToolCallIds: [],
          venueToolCallIds: [],
        }
      }
      case 'directions':
        if (!finalRead.directions) return noCardContent(operations)
        return {
          kind: 'directions',
          events: [],
          directions: finalRead.directions,
          venue: null,
          operations,
          sourceToolCallIds: [],
          directionToolCallIds: [finalRead.toolCallId],
          venueToolCallIds: [],
        }
      case 'venue-details':
        if (!finalRead.venue) return noCardContent(operations)
        return {
          kind: 'venue_details',
          events: [],
          directions: null,
          venue: finalRead.venue,
          operations,
          sourceToolCallIds: [],
          directionToolCallIds: [],
          venueToolCallIds: [finalRead.toolCallId],
        }
      default:
        break
    }
  }

  // No successful read artifact.
  return noCardContent(operations)
}

function textFor(input: FallbackInput, content: DerivedContent): string {
  const es = input.locale === 'es'
  const name = content.events[0]?.name
  const dirName = content.directions?.venueName
  const venueName = content.venue?.venueName

  if (content.operations.length > 0) {
    const opText = content.operations.map((o) => o.message).join(' ')
    let lead = ''
    if (content.kind === 'recommendations') {
      lead = es
        ? 'Estas son las mejores opciones que encontré.'
        : 'Here are the best matches I found.'
    } else if (content.kind === 'event_details' && name) {
      lead = es ? `Acá están los detalles de ${name}.` : `Here are the details for ${name}.`
    }
    return [lead, opText].filter(Boolean).join(' ') || opText
  }

  switch (content.kind) {
    case 'recommendations':
      return es
        ? 'Estas son las mejores opciones que encontré.'
        : 'Here are the best matches I found.'
    case 'event_details':
      return es ? `Acá están los detalles de ${name}.` : `Here are the details for ${name}.`
    case 'saved_events':
      return es ? 'Estos son tus guardados.' : "Here's your saved list."
    case 'directions':
      return es ? `Acá tenés cómo llegar a ${dirName}.` : `Here's how to get to ${dirName}.`
    case 'venue_details':
      return es ? `Esto es lo que encontré de ${venueName}.` : `Here's what I found about ${venueName}.`
    case 'no_results':
      return es
        ? 'No encontré nada que coincida. ¿Querés que amplíe la búsqueda?'
        : "I couldn't find anything matching. Want me to widen the search?"
    case 'mutation_result':
      return content.operations.map((o) => o.message).join(' ')
    default:
      return es ? 'Algo salió mal. Probá de nuevo.' : 'Something went wrong. Please try again.'
  }
}

export function buildFallback(input: FallbackInput): CanonicalChatResponse {
  const content = deriveContent(input)
  const mutationToolCallIds = input.ledger.mutationToolCallIds(input.requestId)
  return {
    contractVersion: CHAT_CONTRACT_VERSION,
    requestId: input.requestId,
    kind: content.kind,
    text: textFor(input, content),
    events: content.events,
    directions: content.directions,
    venue: content.venue,
    operations: content.operations,
    suggestions: [],
    provenance: {
      sourceToolCallIds: content.sourceToolCallIds,
      directionToolCallIds: content.directionToolCallIds,
      venueToolCallIds: content.venueToolCallIds,
      mutationToolCallIds,
      suggestionToolCallIds: [],
      origin: 'fallback',
      fallbackUsed: true,
      fallbackReason: input.reason,
    },
  }
}
