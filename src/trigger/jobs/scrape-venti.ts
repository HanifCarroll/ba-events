/**
 * Venti Scraper Job
 *
 * Imports events from Venti's public API (api.venti.live).
 * Plain server-side fetches — no browser required.
 */
import { task } from '@trigger.dev/sdk/v3'
import { createServiceRoleClient } from '../utils/db-client.ts'
import { processVentiImport, type VentiImportResult } from '#features/import/core/venti.ts'

export interface VentiJobPayload {
  scrapeRunId?: string | null
}

export const scrapeVenti = task({
  id: 'scrape-venti',
  // Catalog + availability fetches + embeddings can take a few minutes
  maxDuration: 1800, // 30 minutes
  run: async (payload: VentiJobPayload): Promise<VentiImportResult> => {
    console.log('[scrape-venti] Starting Venti import job')

    const client = createServiceRoleClient()

    const result = await processVentiImport(client, {
      scrapeRunId: payload.scrapeRunId,
    })

    console.log('[scrape-venti] Job completed:', result)
    return result
  },
})
