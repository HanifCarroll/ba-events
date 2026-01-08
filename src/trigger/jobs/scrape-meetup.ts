/**
 * Meetup Scraper Job
 *
 * Imports events from Meetup.
 * Uses browser automation (Playwright/Browserless) to scrape day-by-day.
 */
import { task } from '@trigger.dev/sdk/v3'
import { createServiceRoleClient } from '../utils/db-client'
import { processMeetupImport, type MeetupImportResult } from '@/features/import/core/meetup'

export interface MeetupJobPayload {
  daysAhead?: number
  scrapeRunId?: string | null
}

export const scrapeMeetup = task({
  id: 'scrape-meetup',
  // Browser scraping can take a long time (day-by-day)
  maxDuration: 1800, // 30 minutes
  run: async (payload: MeetupJobPayload): Promise<MeetupImportResult> => {
    console.log('[scrape-meetup] Starting Meetup import job')

    const client = createServiceRoleClient()

    const result = await processMeetupImport(client, {
      daysAhead: payload.daysAhead ?? 30,
      scrapeRunId: payload.scrapeRunId,
    })

    console.log('[scrape-meetup] Job completed:', result)
    return result
  },
})
