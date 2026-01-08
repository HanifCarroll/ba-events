/**
 * BA Tourism Scraper Job
 *
 * Imports events from BA Tourism website.
 * Uses browser automation (Playwright/Browserless).
 *
 * Note: BA Tourism only shows events for the current week.
 */
import { task } from '@trigger.dev/sdk/v3'
import { createServiceRoleClient } from '../utils/db-client'
import { processBATourismImport, type BATourismImportResult } from '@/features/import/core/ba-tourism'

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

    const result = await processBATourismImport(client, {
      scrapeRunId: payload.scrapeRunId,
    })

    console.log('[scrape-ba-tourism] Job completed:', result)
    return result
  },
})
