/**
 * Daily Scrape Orchestrator
 *
 * Runs daily at 6 AM Buenos Aires time.
 * Coordinates scraping of all 6 event sources and triggers enrichment.
 */
import { schedules, tasks, batch } from '@trigger.dev/sdk/v3'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceRoleClient } from '../utils/db-client.ts'
import { countEventsNeedingEnrichment } from '#features/import/core/event-enrichment.ts'

// Import task types for type-safe triggering
import type { scrapeEventbrite } from './scrape-eventbrite.ts'
import type { scrapeBATourism } from './scrape-ba-tourism.ts'
import type { scrapeMeetup } from './scrape-meetup.ts'
import type { scrapeLuma } from './scrape-luma.ts'
import type { scrapePassline } from './scrape-passline.ts'
import type { scrapeVenti } from './scrape-venti.ts'
import type { enrichEventsJob } from './enrich-events.ts'
import {
  DEFAULT_ENRICHMENT_BATCH_SIZE,
  DEFAULT_ENRICHMENT_MAX_BATCHES,
} from './enrich-events.ts'
import {
  mapBatchRunsToResults,
  summarizeResults,
  finalizeScrapeRun,
  reconcileStaleScrapeRuns,
  type DailyScrapeResult,
} from './daily-scrape-outcome.ts'

// Source job IDs. Passline is listed before Meetup because both consume the
// shared Browserbase queue (concurrencyLimit 1): with sequential batch
// triggering, Passline is enqueued — and therefore runs — first.
const SOURCE_JOBS = [
  { id: 'scrape-passline', name: 'Passline' },
  { id: 'scrape-meetup', name: 'Meetup' },
  { id: 'scrape-eventbrite', name: 'Eventbrite' },
  { id: 'scrape-ba-tourism', name: 'BA Tourism' },
  { id: 'scrape-luma', name: 'Luma' },
  { id: 'scrape-venti', name: 'Venti' },
] as const

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now()
  try {
    return await fn()
  } finally {
    console.log(`[daily-scrape] ${label}: ${Math.round(performance.now() - start)}ms`)
  }
}

/**
 * Clean up existing events that match blocklist patterns.
 * This handles events imported before blocklist entries were added.
 */
async function cleanupBlocklistedEvents(client: SupabaseClient): Promise<number> {
  // Get all blocklist entries
  const { data: blocklistEntries, error: blocklistError } = await client
    .from('import_blocklist')
    .select('pattern, target_field, source')

  if (blocklistError || !blocklistEntries || blocklistEntries.length === 0) {
    return 0
  }

  // Get all events with venue names
  const { data: events, error: eventsError } = await client
    .from('events_with_venues')
    .select('id, name, source, venue_name')

  if (eventsError || !events) {
    console.error('[daily-scrape] Failed to fetch events for blocklist cleanup:', eventsError)
    return 0
  }

  // Find events that match blocklist patterns
  const eventIdsToDelete: string[] = []

  for (const event of events) {
    const lowerEventName = event.name?.toLowerCase() || ''
    const lowerVenueName = event.venue_name?.toLowerCase() || ''

    for (const entry of blocklistEntries) {
      // Check if source matches (entry applies to this source or 'all')
      if (entry.source !== 'all' && entry.source !== event.source) {
        continue
      }

      const pattern = entry.pattern.toLowerCase()

      if (entry.target_field === 'event_name' && lowerEventName.includes(pattern)) {
        eventIdsToDelete.push(event.id)
        break
      }

      if (entry.target_field === 'venue_name' && lowerVenueName.includes(pattern)) {
        eventIdsToDelete.push(event.id)
        break
      }
    }
  }

  if (eventIdsToDelete.length === 0) {
    return 0
  }

  // Delete the matching events
  const { error: deleteError } = await client
    .from('events')
    .delete()
    .in('id', eventIdsToDelete)

  if (deleteError) {
    console.error('[daily-scrape] Failed to delete blocklisted events:', deleteError)
    return 0
  }

  return eventIdsToDelete.length
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
  run: async (payload, { ctx }): Promise<DailyScrapeResult> => {
    console.log('[daily-scrape] Starting daily scrape orchestration')
    console.log(`[daily-scrape] Scheduled time: ${payload.timestamp}`)

    const client = createServiceRoleClient()
    const startedAt = new Date().toISOString()

    try {
      const reconciled = await timed('stale-run reconciliation', () =>
        reconcileStaleScrapeRuns(client, new Date(startedAt))
      )
      if (reconciled > 0) {
        console.warn(`[daily-scrape] Reconciled ${reconciled} stale scrape run(s)`)
      }
    } catch (error) {
      console.error('[daily-scrape] Failed to reconcile stale scrape runs:', error)
    }

    let scrapeRunId: string | null = null
    let scrapeRunMetadata: unknown = null
    let results: DailyScrapeResult['results'] = []
    let enrichmentTriggered = false
    let enrichmentEligible = 0
    let blocklistCleanup = 0

    try {
      // Create a scrape run record for audit
      const { data: scrapeRun, error: runError } = await client
        .from('scrape_runs')
        .insert({
          source: 'all',
          status: 'running',
          trigger_id: ctx.run.id,
          metadata: {
            scheduleId: payload.scheduleId,
            scheduledTime: payload.timestamp,
            lastRun: payload.lastTimestamp,
          },
        })
        .select()
        .single()

      if (runError) {
        throw new Error(`Failed to create scrape run: ${runError.message}`)
      }

      scrapeRunId = scrapeRun.id
      const runId = scrapeRun.id
      scrapeRunMetadata = scrapeRun.metadata
      console.log(`[daily-scrape] Created scrape run: ${scrapeRunId}`)

      // Trigger all six source jobs in one checkpoint-aware batch and wait for
      // all of them to complete. Sequential triggering preserves Passline-
      // before-Meetup enqueue order on the shared Browserbase queue.
      results = await timed('source jobs', async () => {
        const batchResult = await batch.triggerAndWait<
          | typeof scrapePassline
          | typeof scrapeMeetup
          | typeof scrapeEventbrite
          | typeof scrapeBATourism
          | typeof scrapeLuma
          | typeof scrapeVenti
        >(
          [
            { id: 'scrape-passline', payload: { daysAhead: 30, scrapeRunId: runId } },
            { id: 'scrape-meetup', payload: { daysAhead: 14, scrapeRunId: runId } },
            { id: 'scrape-eventbrite', payload: { daysAhead: 30, scrapeRunId: runId } },
            { id: 'scrape-ba-tourism', payload: { scrapeRunId: runId } },
            { id: 'scrape-luma', payload: { scrapeRunId: runId } },
            { id: 'scrape-venti', payload: { scrapeRunId: runId } },
          ],
          { triggerSequentially: true }
        )

        return mapBatchRunsToResults(batchResult.runs, SOURCE_JOBS)
      })

      const totals = summarizeResults(results)
      for (const result of results) {
        if (!result.success) {
          console.error(`[daily-scrape] ${result.source} failed:`, result.error)
        }
      }
      console.log(
        `[daily-scrape] Source jobs completed: ${totals.inserted} inserted, ${totals.updated} updated, ${totals.skipped} skipped`
      )

      // Clean up any events that match blocklist patterns
      // This handles events imported before blocklist entries were added
      blocklistCleanup = await timed('blocklist cleanup', () => cleanupBlocklistedEvents(client))
      if (blocklistCleanup > 0) {
        console.log(`[daily-scrape] Blocklist cleanup: deleted ${blocklistCleanup} events`)
      }

      // Count newly-imported events eligible for enrichment (pending/failed,
      // created after this run started). `eligible` is recorded synchronously
      // on this run's audit metadata; the async chain writes back the rest.
      enrichmentEligible = await timed('enrichment eligible count', () =>
        countEventsNeedingEnrichment(client, { createdAfter: startedAt })
      )

      // Trigger the async enrichment chain (fire-and-forget: the parent does
      // not wait). The chain drains eligible events in bounded batches
      // (100/batch, 1000-event ceiling) and writes final counts back to this
      // scrape run's metadata.
      if (enrichmentEligible > 0) {
        console.log(`[daily-scrape] Triggering enrichment chain for ${enrichmentEligible} eligible events...`)
        try {
          await timed('enrichment trigger', async () => {
            await tasks.trigger<typeof enrichEventsJob>('enrich-events', {
              limit: DEFAULT_ENRICHMENT_BATCH_SIZE,
              createdAfter: startedAt,
              batchNumber: 1,
              maxBatches: DEFAULT_ENRICHMENT_MAX_BATCHES,
              scrapeRunId: runId,
              eligible: enrichmentEligible,
            })
          })
          enrichmentTriggered = true
          console.log('[daily-scrape] Enrichment chain triggered')
        } catch (enrichError) {
          console.error('[daily-scrape] Failed to trigger enrichment:', enrichError)
        }
      }

      const completedAt = new Date().toISOString()
      console.log('[daily-scrape] Daily scrape completed')

      return {
        scrapeRunId: runId,
        startedAt,
        completedAt,
        results,
        enrichmentTriggered,
        enrichmentEligible,
        blocklistCleanup,
      }
    } finally {
      if (scrapeRunId) {
        await finalizeScrapeRun(
          client,
          scrapeRunId,
          scrapeRunMetadata,
          results,
          enrichmentTriggered,
          blocklistCleanup,
          enrichmentEligible
        )
      }
    }
  },
})
