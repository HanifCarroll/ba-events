/**
 * Daily Scrape Orchestrator
 *
 * Runs daily at 6 AM Buenos Aires time.
 * Coordinates scraping of all 5 event sources and triggers enrichment.
 */
import { schedules, tasks, runs } from '@trigger.dev/sdk/v3'
import { createServiceRoleClient } from '../utils/db-client'

// Import task types for type-safe triggering
import type { scrapePassline } from './scrape-passline'
import type { scrapeEventbrite } from './scrape-eventbrite'
import type { scrapeBATourism } from './scrape-ba-tourism'
import type { scrapeMeetup } from './scrape-meetup'
import type { scrapeLuma } from './scrape-luma'
import type { enrichEventsJob } from './enrich-events'

// Source job IDs
const SOURCE_JOBS = [
  { id: 'scrape-passline', name: 'Passline' },
  { id: 'scrape-eventbrite', name: 'Eventbrite' },
  { id: 'scrape-ba-tourism', name: 'BA Tourism' },
  { id: 'scrape-meetup', name: 'Meetup' },
  { id: 'scrape-luma', name: 'Luma' },
] as const

export interface DailyScrapeResult {
  scrapeRunId: string
  startedAt: string
  completedAt: string
  results: {
    source: string
    success: boolean
    eventsInserted: number
    eventsUpdated: number
    eventsSkipped: number
    venuesAutoCreated: number
    error?: string
  }[]
  enrichmentTriggered: boolean
}

export const dailyScrape = schedules.task({
  id: 'daily-scrape',
  // 6 AM Buenos Aires time (UTC-3)
  // Note: Buenos Aires doesn't observe DST, always UTC-3
  cron: {
    pattern: '0 6 * * *',
    timezone: 'America/Buenos_Aires',
  },
  maxDuration: 3600, // 1 hour for full scrape
  run: async (payload): Promise<DailyScrapeResult> => {
    console.log('[daily-scrape] Starting daily scrape orchestration')
    console.log(`[daily-scrape] Scheduled time: ${payload.timestamp}`)

    const client = createServiceRoleClient()
    const startedAt = new Date().toISOString()

    // Create a scrape run record for audit
    const { data: scrapeRun, error: runError } = await client
      .from('scrape_runs')
      .insert({
        source: 'all',
        status: 'running',
        trigger_id: payload.scheduleId,
        metadata: {
          scheduledTime: payload.timestamp,
          lastRun: payload.lastTimestamp,
        },
      })
      .select()
      .single()

    if (runError) {
      console.error('[daily-scrape] Failed to create scrape run:', runError)
      throw new Error(`Failed to create scrape run: ${runError.message}`)
    }

    const scrapeRunId = scrapeRun.id
    console.log(`[daily-scrape] Created scrape run: ${scrapeRunId}`)

    // Trigger all source jobs in parallel
    console.log('[daily-scrape] Triggering source jobs...')

    const handles = await Promise.all([
      tasks.trigger<typeof scrapePassline>('scrape-passline', {
        daysAhead: 30,
        scrapeRunId,
      }),
      tasks.trigger<typeof scrapeEventbrite>('scrape-eventbrite', {
        daysAhead: 30,
        scrapeRunId,
      }),
      tasks.trigger<typeof scrapeBATourism>('scrape-ba-tourism', {
        scrapeRunId,
      }),
      tasks.trigger<typeof scrapeMeetup>('scrape-meetup', {
        daysAhead: 30,
        scrapeRunId,
      }),
      tasks.trigger<typeof scrapeLuma>('scrape-luma', {
        scrapeRunId,
      }),
    ])

    console.log(`[daily-scrape] Triggered ${handles.length} source jobs`)

    // Wait for all jobs to complete
    const runResults = await Promise.allSettled(
      handles.map((handle) => runs.poll(handle.id, { pollIntervalMs: 10000 }))
    )

    // Process results
    const results: DailyScrapeResult['results'] = []
    let totalInserted = 0
    let totalUpdated = 0
    let totalSkipped = 0
    let totalVenuesCreated = 0
    let hasErrors = false

    for (let i = 0; i < SOURCE_JOBS.length; i++) {
      const source = SOURCE_JOBS[i]
      const runResult = runResults[i]

      if (runResult.status === 'fulfilled' && runResult.value.status === 'COMPLETED') {
        const output = runResult.value.output as {
          eventsInserted: number
          eventsUpdated: number
          eventsSkipped: number
          venuesAutoCreated: number
        }

        results.push({
          source: source.name,
          success: true,
          eventsInserted: output.eventsInserted ?? 0,
          eventsUpdated: output.eventsUpdated ?? 0,
          eventsSkipped: output.eventsSkipped ?? 0,
          venuesAutoCreated: output.venuesAutoCreated ?? 0,
        })

        totalInserted += output.eventsInserted ?? 0
        totalUpdated += output.eventsUpdated ?? 0
        totalSkipped += output.eventsSkipped ?? 0
        totalVenuesCreated += output.venuesAutoCreated ?? 0
      } else {
        hasErrors = true
        const error =
          runResult.status === 'rejected'
            ? runResult.reason?.message ?? 'Unknown error'
            : runResult.value.status

        results.push({
          source: source.name,
          success: false,
          eventsInserted: 0,
          eventsUpdated: 0,
          eventsSkipped: 0,
          venuesAutoCreated: 0,
          error,
        })

        console.error(`[daily-scrape] ${source.name} failed:`, error)
      }
    }

    console.log(`[daily-scrape] Source jobs completed: ${totalInserted} inserted, ${totalUpdated} updated, ${totalSkipped} skipped`)

    // Trigger enrichment job for newly imported events
    let enrichmentTriggered = false
    if (totalInserted > 0) {
      console.log('[daily-scrape] Triggering enrichment job...')
      try {
        await tasks.trigger<typeof enrichEventsJob>('enrich-events', {
          limit: 100,
          createdAfter: startedAt,
        })
        enrichmentTriggered = true
        console.log('[daily-scrape] Enrichment job triggered')
      } catch (enrichError) {
        console.error('[daily-scrape] Failed to trigger enrichment:', enrichError)
      }
    }

    // Update scrape run with final stats
    const completedAt = new Date().toISOString()
    const { error: updateError } = await client
      .from('scrape_runs')
      .update({
        status: hasErrors ? 'partial' : 'completed',
        completed_at: completedAt,
        events_fetched: totalInserted + totalUpdated + totalSkipped,
        events_inserted: totalInserted,
        events_updated: totalUpdated,
        events_skipped: totalSkipped,
        venues_auto_created: totalVenuesCreated,
        metadata: {
          ...scrapeRun.metadata,
          results,
          enrichmentTriggered,
        },
      })
      .eq('id', scrapeRunId)

    if (updateError) {
      console.error('[daily-scrape] Failed to update scrape run:', updateError)
    }

    console.log('[daily-scrape] Daily scrape completed')

    return {
      scrapeRunId,
      startedAt,
      completedAt,
      results,
      enrichmentTriggered,
    }
  },
})
