/**
 * Bounded previous-search context for contextual refinements.
 *
 * New v5 responses may carry an additive `searchContext` field inside the
 * canonical payload. The strict v5 renderer ignores unknown fields but preserves
 * the object verbatim, so this metadata survives authenticated persistence,
 * guest IndexedDB, and reload without a contract-version bump.
 */

import type { UIMessage } from 'ai'
import { Schema } from 'effect'
import type { CanonicalChatResponse, Message } from '#shared/lib/types.ts'
import {
  adaptStoredMessageToCanonical,
  canonicalFromDataResponse,
} from '#features/chat/lib/canonical.ts'
import type { SearchEventsInput } from '../tools/search-events.ts'
import { sanitizeText } from './follow-up.ts'

const MAX_QUERY_CHARS = 2000
const MAX_FILTER_STRING = 200
const MAX_FILTER_VALUES = 20

const boundedString = (max: number) => Schema.String.pipe(Schema.check(Schema.isMaxLength(max)))
const boundedSearchInputSchema = Schema.Struct({
  query: Schema.optional(boundedString(MAX_QUERY_CHARS)),
  categories: Schema.optional(Schema.Array(boundedString(MAX_FILTER_STRING)).pipe(Schema.check(Schema.isMaxLength(MAX_FILTER_VALUES)))),
  neighborhoods: Schema.optional(Schema.Array(boundedString(MAX_FILTER_STRING)).pipe(Schema.check(Schema.isMaxLength(MAX_FILTER_VALUES)))),
  venueName: Schema.optional(boundedString(MAX_FILTER_STRING)),
  venueIds: Schema.optional(Schema.Array(boundedString(128)).pipe(Schema.check(Schema.isMaxLength(MAX_FILTER_VALUES)))),
  dateFrom: Schema.optional(boundedString(64)),
  dateTo: Schema.optional(boundedString(64)),
  isFree: Schema.optional(Schema.Boolean),
  maxPrice: Schema.optional(Schema.Number),
  minAge: Schema.optional(Schema.Number),
  timeFilter: Schema.optional(Schema.Literals(['now', 'tonight', 'tomorrow', 'weekend', 'week', 'future'])),
  avoid: Schema.optional(Schema.Array(boundedString(MAX_FILTER_STRING)).pipe(Schema.check(Schema.isMaxLength(MAX_FILTER_VALUES)))),
  objective: Schema.optional(Schema.Literals(['search', 'surprise'])),
  limit: Schema.optional(Schema.Int.pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(1)),
    Schema.check(Schema.isLessThanOrEqualTo(5)),
  )),
})

const lastSearchContextSchema = Schema.Struct({
  originalQuery: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(MAX_QUERY_CHARS)),
  ),
  input: boundedSearchInputSchema,
})

export interface LastSearchContext {
  originalQuery: string
  input: SearchEventsInput
}

type CanonicalWithSearchContext = CanonicalChatResponse & {
  searchContext?: LastSearchContext | null
}

/** Validate and copy search context from an untrusted canonical payload. */
export function searchContextFromCanonical(data: unknown): LastSearchContext | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const candidate = (data as { searchContext?: unknown }).searchContext
  const parsed = Schema.decodeUnknownResult(lastSearchContextSchema, { onExcessProperty: 'error' })(candidate)
  if (parsed._tag !== 'Success') return null
  return {
    originalQuery: sanitizeText(parsed.success.originalQuery, MAX_QUERY_CHARS),
    input: parsed.success.input as unknown as SearchEventsInput,
  }
}

/**
 * Attach the exact executed search input to a canonical response. Invalid or
 * oversized data is ignored rather than persisted.
 */
export function attachSearchContext(
  canonical: CanonicalChatResponse,
  context: { originalQuery: string; input: unknown }
): CanonicalChatResponse {
  const parsed = Schema.decodeUnknownResult(lastSearchContextSchema, { onExcessProperty: 'error' })({
    originalQuery: sanitizeText(context.originalQuery, MAX_QUERY_CHARS),
    input: context.input,
  })
  if (parsed._tag !== 'Success') return canonical
  ;(canonical as CanonicalWithSearchContext).searchContext = {
    originalQuery: parsed.success.originalQuery,
    input: parsed.success.input as unknown as SearchEventsInput,
  }
  return canonical
}

/** Newest valid search context from persistent assistant `data-response` parts. */
export function lastSearchContextFromUIMessages(
  messages: UIMessage[]
): LastSearchContext | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const message = messages[messageIndex]
    if ((message as { role?: string }).role !== 'assistant') continue
    const parts = (message.parts ?? []) as Array<{ type?: string; data?: unknown }>
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex--) {
      const part = parts[partIndex]
      if (part.type !== 'data-response') continue
      const canonical = canonicalFromDataResponse(part.data)
      if (!canonical) continue
      const context = searchContextFromCanonical(canonical)
      if (context) return context
    }
  }
  return null
}

/** Newest valid search context from authenticated persisted assistant rows. */
export function lastSearchContextFromMessages(messages: Message[]): LastSearchContext | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role !== 'assistant') continue
    const canonical = adaptStoredMessageToCanonical(message)
    const context = searchContextFromCanonical(canonical)
    if (context) return context
  }
  return null
}

/** Server-owned current calendar date in America/Argentina/Buenos_Aires. */
export function currentDateInBuenosAires(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = new Map(parts.map((part) => [part.type, part.value]))
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`
}
