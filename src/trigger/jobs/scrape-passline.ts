/**
 * Passline Scraper Job
 *
 * Imports events from Passline API.
 */
import { task } from '@trigger.dev/sdk/v3'
import { createServiceRoleClient } from '../utils/db-client'
import { processPasslineImport, type PasslineImportResult } from '@/features/import/core/passline'

export interface PasslineJobPayload {
  daysAhead?: number
  scrapeRunId?: string | null
}

export const scrapePassline = task({
  id: 'scrape-passline',
  run: async (payload: PasslineJobPayload): Promise<PasslineImportResult> => {
    console.log('[scrape-passline] Starting Passline import job')

    const client = createServiceRoleClient()

    const result = await processPasslineImport(client, {
      daysAhead: payload.daysAhead ?? 30,
      scrapeRunId: payload.scrapeRunId,
    })

    console.log('[scrape-passline] Job completed:', result)
    return result
  },
})
