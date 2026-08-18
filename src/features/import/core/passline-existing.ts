/**
 * Passline Existing-Event Lookup
 *
 * Fetches the current Passline event rows for a set of external ids so the
 * importer can classify each incoming event. Extracted from the core import so
 * the "throw on query error" behavior is unit-testable with a fake Supabase
 * client, without pulling in AI, embedding, or browser modules.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '#shared/lib/logger.ts'
import type { ExistingPasslineEvent } from './passline-classify.ts'

/**
 * Fetch existing Passline events by external id.
 *
 * Throws on any Supabase query error: a failed lookup must never be mistaken
 * for "no existing rows", which would re-insert every event as new.
 */
export async function fetchExistingPasslineEvents(
  client: SupabaseClient,
  externalIds: string[]
): Promise<Map<string, ExistingPasslineEvent>> {
  if (externalIds.length === 0) return new Map()

  const { data, error } = await client
    .from('events')
    .select(
      'id, external_id, name, starts_at, ends_at, is_all_day, venue_id, price, is_free, time_tba, ticket_url, location_tba, image_url, link, description_es, description_en, categories, facets'
    )
    .eq('source', 'passline')
    .in('external_id', externalIds)

  if (error) {
    throw new Error(`Failed to fetch existing Passline events: ${error.message}`)
  }

  const result = new Map<string, ExistingPasslineEvent>()
  for (const event of data ?? []) {
    if (event.external_id) {
      result.set(event.external_id, event as ExistingPasslineEvent)
    }
  }

  if (result.size > 0) {
    logger.info('[passline] Found existing events', { count: result.size })
  }

  return result
}
