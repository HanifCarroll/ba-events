/**
 * Luma Scraper Job
 *
 * Imports events from Luma Buenos Aires page.
 */
import { task } from '@trigger.dev/sdk/v3'
import { Effect } from 'effect'
import { createServiceRoleClient } from '../utils/db-client.ts'
import { processLumaImportEffect, type LumaImportResult } from '#features/import/core/luma.ts'

export interface LumaJobPayload {
  scrapeRunId?: string | null
}

export const scrapeLuma = task({
  id: 'scrape-luma',
  run: async (payload: LumaJobPayload): Promise<LumaImportResult> => {
    console.log('[scrape-luma] Starting Luma import job')

    const client = createServiceRoleClient()

    const result = await Effect.runPromise(processLumaImportEffect(client, {
      scrapeRunId: payload.scrapeRunId,
    }))

    console.log('[scrape-luma] Job completed:', result)
    return result
  },
})
