/**
 * Bounded previous-search context for contextual refinements.
 *
 * New v5 responses may carry an additive `searchContext` field inside the
 * canonical payload. The strict v5 renderer ignores unknown fields but preserves
 * the object verbatim, so this metadata survives authenticated persistence,
 * guest IndexedDB, and reload without a contract-version bump.
 */

import type { UIMessage } from 'ai'
import { z } from 'zod'
import type { CanonicalChatResponse, Message } from '#shared/lib/types.ts'
import {
  adaptStoredMessageToCanonical,
  canonicalFromDataResponse,
} from '#features/chat/lib/canonical.ts'
import { searchEventsInputSchema, type SearchEventsInput } from '../tools/search-events.ts'
import { sanitizeText } from './follow-up.ts'

const MAX_QUERY_CHARS = 2000
const MAX_FILTER_STRING = 200
const MAX_FILTER_VALUES = 20

const boundedSearchInputSchema = searchEventsInputSchema
  .extend({
    query: z.string().max(MAX_QUERY_CHARS).optional(),
    categories: z.array(z.string().max(MAX_FILTER_STRING)).max(MAX_FILTER_VALUES).optional(),
    neighborhoods: z.array(z.string().max(MAX_FILTER_STRING)).max(MAX_FILTER_VALUES).optional(),
    venueName: z.string().max(MAX_FILTER_STRING).optional(),
    venueIds: z.array(z.string().max(128)).max(MAX_FILTER_VALUES).optional(),
    dateFrom: z.string().max(64).optional(),
    dateTo: z.string().max(64).optional(),
    avoid: z.array(z.string().max(MAX_FILTER_STRING)).max(MAX_FILTER_VALUES).optional(),
    limit: z.number().int().min(1).max(5).optional(),
  })
  .strict()

const lastSearchContextSchema = z
  .object({
    originalQuery: z.string().min(1).max(MAX_QUERY_CHARS),
    input: boundedSearchInputSchema,
  })
  .strict()

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
  const parsed = lastSearchContextSchema.safeParse(candidate)
  if (!parsed.success) return null
  return {
    originalQuery: sanitizeText(parsed.data.originalQuery, MAX_QUERY_CHARS),
    input: parsed.data.input,
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
  const parsed = lastSearchContextSchema.safeParse({
    originalQuery: sanitizeText(context.originalQuery, MAX_QUERY_CHARS),
    input: context.input,
  })
  if (!parsed.success) return canonical
  ;(canonical as CanonicalWithSearchContext).searchContext = {
    originalQuery: parsed.data.originalQuery,
    input: parsed.data.input,
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
