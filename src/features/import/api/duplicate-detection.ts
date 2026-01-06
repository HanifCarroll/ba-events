/**
 * Shared Duplicate Detection for Event Import
 *
 * Checks if events with given external_ids already exist in the database.
 * Used by all import sources to flag already-imported events.
 */

import { supabase } from '@/shared/lib/db/client'
import type { ImportSource } from '../adapters/types'

/**
 * Check which external IDs already exist in the database for a given source
 *
 * @param externalIds - Array of external IDs to check
 * @param source - The import source (passline, eventbrite, etc.)
 * @returns Set of external IDs that already exist
 */
export async function checkDuplicateEvents(
  externalIds: string[],
  source: ImportSource
): Promise<Set<string>> {
  if (externalIds.length === 0) return new Set()

  const { data: existingEvents } = await supabase
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
