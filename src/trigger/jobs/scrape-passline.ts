import { withAcquisitionRun } from '#features/import/acquisition/run.ts'
/**
 * Passline Scraper Job
 *
 * Imports events from Passline.
 * Uses a Browserbase cloud browser (residential proxy) to bypass Passline's
 * Cloudflare protection, which blocks plain server-side HTTP requests.
 */
import { task } from '@trigger.dev/sdk/v3'
import { Effect } from 'effect'
import { createServiceRoleClient } from '../utils/db-client.ts'
import { browserbaseScraperQueue } from '../queues.ts'
import { processPasslineImportEffect, type PasslineImportResult } from '#features/import/core/passline.ts'

export interface PasslineJobPayload {
  daysAhead?: number
  scrapeRunId?: string | null
}

export const scrapePassline = task({
  id: 'scrape-passline',
  // Shared queue: only one Browserbase-consuming scraper runs at a time
  queue: browserbaseScraperQueue,
  // Browserbase scraping + embedding generation can take a while
  maxDuration: 1800, // 30 minutes
  // Start with medium machine for cost efficiency (1 vCPU, 2GB RAM)
  machine: 'medium-1x',
  retry: {
    maxAttempts: 3,
    // Escalate to larger machine only on OOM
    outOfMemory: {
      machine: 'large-1x', // 4 vCPU, 8GB RAM
    },
  },
  run: async (payload: PasslineJobPayload, { ctx }): Promise<PasslineImportResult> => withAcquisitionRun(ctx.run.id, async () => {
    console.log('[scrape-passline] Starting Passline import job')

    const client = createServiceRoleClient()

    const result = await Effect.runPromise(processPasslineImportEffect(client, {
      daysAhead: payload.daysAhead ?? 30,
      scrapeRunId: payload.scrapeRunId,
    }))

    console.log('[scrape-passline] Job completed:', result)
    return result
  }),
})
