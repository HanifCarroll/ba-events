/**
 * Passline Existing-Event Lookup
 *
 * Fetches the current Passline event rows for a set of external ids so the
 * importer can classify each incoming event. Extracted from the core import so
 * the "throw on query error" behavior is unit-testable with a fake Supabase
 * client, without pulling in AI, embedding, or browser modules.
 */
import { Data, Effect } from 'effect'
import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '#shared/lib/logger.ts'
import type { ExistingPasslineEvent } from './passline-classify.ts'
import { importTry } from './effect-utils.ts'

export class PasslineExistingEventsError extends Data.TaggedError('PasslineExistingEventsError')<{
  readonly message: string
  readonly cause?: unknown
}> {}

/**
 * Fetch existing Passline events by external id.
 *
 * Throws on any Supabase query error: a failed lookup must never be mistaken
 * for "no existing rows", which would re-insert every event as new.
 */
export function fetchExistingPasslineEventsEffect(
  client: SupabaseClient,
  externalIds: string[]
): Effect.Effect<Map<string, ExistingPasslineEvent>, PasslineExistingEventsError> {
  if (externalIds.length === 0) return Effect.succeed(new Map<string, ExistingPasslineEvent>())

  return importTry('passline-existing.lookup', () => client
    .from('events')
    .select(
      'id, external_id, name, starts_at, ends_at, is_all_day, venue_id, price, is_free, time_tba, ticket_url, location_tba, image_url, link, description_es, description_en, categories, facets'
    )
    .eq('source', 'passline')
    .in('external_id', externalIds)
  ).pipe(
    Effect.flatMap(({ data, error }) => {
      if (error) {
        return Effect.fail(new PasslineExistingEventsError({
          message: `Failed to fetch existing Passline events: ${error.message}`,
          cause: error,
        }))
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

      return Effect.succeed(result)
    }),
    Effect.mapError((error) => error instanceof PasslineExistingEventsError
      ? error
      : new PasslineExistingEventsError({ message: error.message, cause: error.cause }))
  )
}

/** Promise compatibility adapter preserving the legacy error text. */
export async function fetchExistingPasslineEvents(
  client: SupabaseClient,
  externalIds: string[]
): Promise<Map<string, ExistingPasslineEvent>> {
  try {
    return await Effect.runPromise(fetchExistingPasslineEventsEffect(client, externalIds))
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error))
  }
}
