import { withAcquisitionRun } from '#features/import/acquisition/run.ts'
/**
 * Meetup Scraper Job
 *
 * Imports events from Meetup.
 * Uses browser automation (Browserbase cloud browser) to scrape day-by-day.
 */
import { task } from '@trigger.dev/sdk/v3'
import { Effect } from 'effect'
import { createServiceRoleClient } from '../utils/db-client.ts'
import { browserbaseScraperQueue } from '../queues.ts'
import { processMeetupImportEffect, type MeetupImportResult } from '#features/import/core/meetup.ts'

export interface MeetupJobPayload {
  daysAhead?: number
  scrapeRunId?: string | null
}

export const scrapeMeetup = task({
  id: 'scrape-meetup',
  // Shared queue: only one Browserbase-consuming scraper runs at a time
  queue: browserbaseScraperQueue,
  // Browser scraping can take a long time (day-by-day)
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
  run: async (payload: MeetupJobPayload, { ctx }): Promise<MeetupImportResult> => withAcquisitionRun(ctx.run.id, async () => {
    console.log('[scrape-meetup] Starting Meetup import job')

    const client = createServiceRoleClient()

    const result = await Effect.runPromise(processMeetupImportEffect(client, {
      daysAhead: payload.daysAhead ?? 14,
      scrapeRunId: payload.scrapeRunId,
    }))

    console.log('[scrape-meetup] Job completed:', result)
    return result
  }),
})
