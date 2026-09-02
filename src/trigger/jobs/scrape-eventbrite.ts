/**
 * Eventbrite Scraper Job
 *
 * Imports events from Eventbrite JSON-LD page.
 */
import { task } from '@trigger.dev/sdk/v3'
import { Effect } from 'effect'
import { createServiceRoleClient } from '../utils/db-client.ts'
import { processEventbriteImportEffect, type EventbriteImportResult } from '#features/import/core/eventbrite.ts'

export interface EventbriteJobPayload {
  daysAhead?: number
  scrapeRunId?: string | null
}

export const scrapeEventbrite = task({
  id: 'scrape-eventbrite',
  run: async (payload: EventbriteJobPayload): Promise<EventbriteImportResult> => {
    console.log('[scrape-eventbrite] Starting Eventbrite import job')

    const client = createServiceRoleClient()

    const result = await Effect.runPromise(processEventbriteImportEffect(client, {
      daysAhead: payload.daysAhead ?? 30,
      scrapeRunId: payload.scrapeRunId,
    }))

    console.log('[scrape-eventbrite] Job completed:', result)
    return result
  },
})
