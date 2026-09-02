/**
 * BA Tourism Scraper Job
 *
 * Imports events from BA Tourism website.
 * Uses browser automation (local Playwright).
 *
 * Note: BA Tourism only shows events for the current week.
 */
import { task } from '@trigger.dev/sdk/v3'
import { Effect } from 'effect'
import { createServiceRoleClient } from '../utils/db-client.ts'
import { processBATourismImportEffect, type BATourismImportResult } from '#features/import/core/ba-tourism.ts'

export interface BATourismJobPayload {
  scrapeRunId?: string | null
}

export const scrapeBATourism = task({
  id: 'scrape-ba-tourism',
  // Browser scraping can take longer
  maxDuration: 600, // 10 minutes
  run: async (payload: BATourismJobPayload): Promise<BATourismImportResult> => {
    console.log('[scrape-ba-tourism] Starting BA Tourism import job')

    const client = createServiceRoleClient()

    const result = await Effect.runPromise(processBATourismImportEffect(client, {
      scrapeRunId: payload.scrapeRunId,
    }))

    console.log('[scrape-ba-tourism] Job completed:', result)
    return result
  },
})
