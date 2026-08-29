import type { EventInsert } from '#shared/lib/types.ts'
import type { ExistingEventData } from '../api/duplicate-detection.ts'

export type ScraperUpdateKind = 'unchanged' | 'mutable-only' | 'search-input/stale-embedding'

const mutableFields = [
  'starts_at', 'ends_at', 'is_all_day', 'time_tba', 'venue_id', 'min_age',
  'image_url', 'image_width', 'image_height', 'link', 'ticket_url', 'status',
  'location_hidden', 'location_tba', 'description_unavailable',
] as const

type MutableField = (typeof mutableFields)[number]
const searchFields = ['name', 'description_es', 'description_en', 'categories', 'facets', 'price', 'is_free', 'venue_id'] as const

function equal(field: string, a: unknown, b: unknown): boolean {
  if (field === 'starts_at' || field === 'ends_at') {
    if (a === b) return true
    if (!a || !b) return a === b
    return new Date(a as string).getTime() === new Date(b as string).getTime()
  }
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/** Return only mutable source columns that differ, preserving an existing venue for empty scrapes. */
export function getChangedMutableFields(
  incoming: EventInsert,
  existing: ExistingEventData
): Partial<Pick<EventInsert, MutableField>> {
  const changes: Partial<EventInsert> = {}
  for (const field of mutableFields) {
    const next = incoming[field]
    if (next === undefined || (field === 'venue_id' && next === null) || equal(field, next, existing[field])) continue
    Object.assign(changes, { [field]: next })
  }
  return changes
}

export function sourceDescriptionsChanged(
  incoming: EventInsert,
  existing: ExistingEventData
): boolean {
  return !equal('description_es', incoming.description_es, existing.description_es)
    || !equal('description_en', incoming.description_en, existing.description_en)
}

/** Classify an existing scraper record without treating presentation fields as source inputs. */
export function classifyScraperUpdate(
  incoming: EventInsert,
  existing: ExistingEventData,
  embeddingVersion: number
): ScraperUpdateKind {
  if (existing.embedding_version !== embeddingVersion || searchFields.some((field) => {
    const next = incoming[field]
    if (next === undefined || (field === 'venue_id' && next === null)) return false
    return !equal(field, next, existing[field])
  })) {
    return 'search-input/stale-embedding'
  }
  return Object.keys(getChangedMutableFields(incoming, existing)).length > 0
    ? 'mutable-only'
    : 'unchanged'
}
