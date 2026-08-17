/**
 * v2 → v3 canonical adapter.
 *
 * Historical messages store `visible_content` + legacy `attached_data`
 * (`events` / `suggestions` / `directions`) with no canonical response. This
 * read-only adapter produces a canonical-shaped object so v3 rendering and
 * follow-up context can consume both versions uniformly. No historical rows
 * are rewritten; provenance origin is `legacy_unknown`.
 */

import type {
  CanonicalChatResponse,
  MessageAttachedData,
  ResponseKind,
} from '#shared/lib/types.ts'
import { CHAT_CONTRACT_VERSION } from '#shared/lib/types.ts'

export function deriveLegacyKind(
  attached: MessageAttachedData | undefined,
  text: string
): ResponseKind {
  const events = attached?.events ?? []
  if (attached?.directions) return events.length > 0 ? 'recommendations' : 'directions'
  if (events.length >= 1) return 'recommendations'
  return text.trim() ? 'out_of_scope' : 'no_results'
}

export function adaptLegacyToCanonical(message: {
  id: string
  visible_content?: string | null
  content?: string | null
  attached_data?: MessageAttachedData | null
}): CanonicalChatResponse {
  const attached = message.attached_data ?? {}
  const text = (message.visible_content ?? message.content ?? '').trim()
  return {
    contractVersion: CHAT_CONTRACT_VERSION,
    requestId: `legacy:${message.id}`,
    kind: deriveLegacyKind(attached, text),
    text,
    events: attached.events ?? [],
    directions: attached.directions ?? null,
    venue: null,
    operations: [],
    suggestions: attached.suggestions ?? [],
    provenance: {
      sourceToolCallIds: [],
      directionToolCallIds: [],
      venueToolCallIds: [],
      mutationToolCallIds: [],
      suggestionToolCallIds: [],
      origin: 'legacy_unknown',
      fallbackUsed: false,
      fallbackReason: null,
    },
  }
}

/** Renderable fields derived from a canonical response (v3) or legacy data. */
export function canonicalToRender(canonical: CanonicalChatResponse): {
  events: CanonicalChatResponse['events']
  suggestions: CanonicalChatResponse['suggestions']
  directions: CanonicalChatResponse['directions']
  venue: CanonicalChatResponse['venue']
  operations: CanonicalChatResponse['operations']
} {
  return {
    events: canonical.events,
    suggestions: canonical.suggestions,
    directions: canonical.directions,
    venue: canonical.venue,
    operations: canonical.operations,
  }
}
