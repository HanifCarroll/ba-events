/**
 * Shared Duplicate Detection for Event Import
 *
 * Checks if events with given external_ids already exist in the database.
 * Used by all import sources to flag already-imported events.
 * Enhanced to support field-by-field diff comparison.
 *
 * IMPORTANT: When using from Trigger.dev jobs, pass the service role client
 * to ensure visibility of all events (bypasses RLS).
 */

import { getSupabase, type SupabaseClient } from '#shared/lib/db/client.server.ts'
import type { EventInsert } from '#shared/lib/types.ts'
import type { ImportSource } from '../adapters/types.ts'

// Fields we compare for detecting changes (initial scrape fields only, not enriched)
export const DIFF_FIELDS = [
  'name',
  'starts_at',
  'ends_at',
  'venue_id',
  'price',
  'image_url',
  'link',
] as const

export type DiffField = (typeof DIFF_FIELDS)[number]

export interface FieldDiff {
  field: DiffField
  existingValue: string | number | boolean | null
  newValue: string | number | boolean | null
  hasChanged: boolean
}

export interface DuplicateInfo {
  existingId: string
  externalId: string
  diffs: FieldDiff[]
  hasChanges: boolean
}

// Data fetched from existing events for comparison
export interface ExistingEventData {
  id: string
  external_id: string
  name: string
  description_es: string | null
  description_en: string | null
  starts_at: string
  ends_at: string | null
  is_all_day: boolean
  time_tba: boolean
  venue_id: string | null
  categories: string[]
  price: number | null
  is_free: boolean
  min_age: number | null
  image_url: string | null
  image_width: number | null
  image_height: number | null
  link: string | null
  ticket_url: string | null
  status: EventInsert['status']
  location_hidden: boolean
  location_tba: boolean
  description_unavailable: boolean
  facets: NonNullable<EventInsert['facets']>
  embedding_version: number | null
}

/**
 * Check which external IDs already exist in the database for a given source
 *
 * @param externalIds - Array of external IDs to check
 * @param source - The import source (passline, eventbrite, etc.)
 * @param client - Optional Supabase client (use service role client in Trigger.dev jobs)
 * @returns Set of external IDs that already exist
 */
export async function checkDuplicateEvents(
  externalIds: string[],
  source: ImportSource,
  client?: SupabaseClient
): Promise<Set<string>> {
  if (externalIds.length === 0) return new Set()

  const db = client ?? getSupabase()
  const { data: existingEvents } = await db
    .from('events')
    .select('external_id')
    .eq('source', source)
    .in('external_id', externalIds)

  const existingIds = new Set<string>()
  if (existingEvents) {
    for (const event of existingEvents) {
      if (event.external_id) {
        existingIds.add(event.external_id)
      }
    }
  }

  if (existingIds.size > 0) {
    console.log(`[duplicate-detection] Found ${existingIds.size} already imported ${source} events`)
  }

  return existingIds
}

/**
 * Extract external IDs from an array of preview events
 * Handles both single EventInsert and EventInsert[] transforms
 */
export function extractExternalIds<T>(
  previews: T[],
  getTransformed: (preview: T) => { external_id?: string | null } | { external_id?: string | null }[]
): string[] {
  const ids: string[] = []

  for (const preview of previews) {
    const transformed = getTransformed(preview)

    if (Array.isArray(transformed)) {
      for (const t of transformed) {
        if (t.external_id) ids.push(t.external_id)
      }
    } else {
      if (transformed.external_id) ids.push(transformed.external_id)
    }
  }

  return ids
}

/**
 * Check which external IDs already exist and return full event data for comparison
 *
 * @param externalIds - Array of external IDs to check
 * @param source - The import source (passline, eventbrite, etc.)
 * @param client - Optional Supabase client (use service role client in Trigger.dev jobs)
 * @returns Map of external_id -> existing event data
 */
export async function checkDuplicateEventsWithData(
  externalIds: string[],
  source: ImportSource,
  client?: SupabaseClient
): Promise<Map<string, ExistingEventData>> {
  if (externalIds.length === 0) return new Map()

  const db = client ?? getSupabase()
  const { data: existingEvents } = await db
    .from('events')
    .select('id, external_id, name, description_es, description_en, starts_at, ends_at, is_all_day, time_tba, venue_id, categories, price, is_free, min_age, image_url, image_width, image_height, link, ticket_url, status, location_hidden, location_tba, description_unavailable, facets, embedding_version')
    .eq('source', source)
    .in('external_id', externalIds)

  const result = new Map<string, ExistingEventData>()

  if (existingEvents) {
    for (const event of existingEvents) {
      if (event.external_id) {
        result.set(event.external_id, event as ExistingEventData)
      }
    }
  }

  if (result.size > 0) {
    console.log(
      `[duplicate-detection] Found ${result.size} already imported ${source} events (with data for diff)`
    )
  }

  return result
}

/**
 * Compare two date values by their actual timestamp, not string representation
 */
function areDatesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!a || !b) return a === b

  try {
    const dateA = new Date(a as string)
    const dateB = new Date(b as string)
    // Compare timestamps (milliseconds since epoch)
    return dateA.getTime() === dateB.getTime()
  } catch {
    // If parsing fails, fall back to string comparison
    return a === b
  }
}

/**
 * Compute field-level diffs between a new event and existing event data
 */
export function computeDiffs(
  newEvent: EventInsert,
  existingEvent: ExistingEventData
): FieldDiff[] {
  return DIFF_FIELDS.map((field) => {
    const existingValue = existingEvent[field] ?? null
    const newValue = newEvent[field] ?? null

    // Use date comparison for datetime fields
    let hasChanged: boolean
    if (field === 'starts_at' || field === 'ends_at') {
      hasChanged = !areDatesEqual(existingValue, newValue)
    } else if (field === 'venue_id') {
      // Preserve existing venue_id when new is null (some sources don't return venue on initial scrape)
      // Only mark as changed if new value is non-null and different
      hasChanged = newValue !== null && existingValue !== newValue
    } else {
      hasChanged = existingValue !== newValue
    }

    return {
      field,
      existingValue,
      newValue,
      hasChanged,
    }
  })
}

/**
 * Build DuplicateInfo from new event and existing event data
 */
export function buildDuplicateInfo(
  newEvent: EventInsert,
  existingEvent: ExistingEventData
): DuplicateInfo {
  const diffs = computeDiffs(newEvent, existingEvent)
  const hasChanges = diffs.some((d) => d.hasChanged)

  return {
    existingId: existingEvent.id,
    externalId: existingEvent.external_id,
    diffs,
    hasChanges,
  }
}
