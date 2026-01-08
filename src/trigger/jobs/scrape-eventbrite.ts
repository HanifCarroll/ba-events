/**
 * Eventbrite Scraper Job
 *
 * Imports events from Eventbrite JSON-LD page.
 */
import { task } from '@trigger.dev/sdk/v3'
import { createServiceRoleClient } from '../utils/db-client'
import { processEventbriteImport, type EventbriteImportResult } from '@/features/import/core/eventbrite'

export interface EventbriteJobPayload {
  daysAhead?: number
  scrapeRunId?: string | null
}

export const scrapeEventbrite = task({
  id: 'scrape-eventbrite',
  run: async (payload: EventbriteJobPayload): Promise<EventbriteImportResult> => {
    console.log('[scrape-eventbrite] Starting Eventbrite import job')

    const client = createServiceRoleClient()

    const result = await processEventbriteImport(client, {
      daysAhead: payload.daysAhead ?? 30,
      scrapeRunId: payload.scrapeRunId,
    })

    console.log('[scrape-eventbrite] Job completed:', result)
    return result
  },
})
