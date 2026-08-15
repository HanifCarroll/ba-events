/**
 * Daily Scrape Orchestrator
 *
 * Runs daily at 6 AM Buenos Aires time.
 * Coordinates scraping of all 6 event sources and triggers enrichment.
 */
import { schedules, tasks, runs } from '@trigger.dev/sdk/v3'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceRoleClient } from '../utils/db-client.ts'

// Import task types for type-safe triggering
import type { scrapeEventbrite } from './scrape-eventbrite.ts'
import type { scrapeBATourism } from './scrape-ba-tourism.ts'
import type { scrapeMeetup } from './scrape-meetup.ts'
import type { scrapeLuma } from './scrape-luma.ts'
import type { scrapePassline } from './scrape-passline.ts'
import type { scrapeVenti } from './scrape-venti.ts'
import type { enrichEventsJob } from './enrich-events.ts'

// Source job IDs
const SOURCE_JOBS = [
  { id: 'scrape-eventbrite', name: 'Eventbrite' },
  { id: 'scrape-ba-tourism', name: 'BA Tourism' },
  { id: 'scrape-meetup', name: 'Meetup' },
  { id: 'scrape-luma', name: 'Luma' },
  { id: 'scrape-passline', name: 'Passline' },
  { id: 'scrape-venti', name: 'Venti' },
] as const

function getUnknownMessage(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  if (typeof value !== 'object') return String(value)

  const record = value as Record<string, unknown>
  if (typeof record.message === 'string') return record.message
  if (typeof record.error === 'string') return record.error
  if (typeof record.reason === 'string') return record.reason

  if (record.error && typeof record.error === 'object') {
    const nestedMessage = getUnknownMessage(record.error)
    if (nestedMessage) return nestedMessage
  }

  return null
}

function describeFailedRunResult(
  runResult: PromiseSettledResult<{ status?: string; error?: unknown; reason?: unknown }>
): string {
  if (runResult.status === 'rejected') {
    return getUnknownMessage(runResult.reason) ?? 'Rejected without error details'
  }

  const value = runResult.value
  const status = value.status ?? 'UNKNOWN'
  const detail = getUnknownMessage(value.error) ?? getUnknownMessage(value.reason)

  return detail ? `${status}: ${detail}` : status
}

function buildScrapeRunErrorMessage(results: DailyScrapeResult['results']): string | null {
  const failed = results.filter((result) => !result.success)
  if (failed.length === 0) return null

  return failed
    .map((result) => `${result.source}: ${result.error ?? 'Unknown failure'}`)
    .join('; ')
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
  blocklistCleanup: number
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
      tasks.trigger<typeof scrapeEventbrite>('scrape-eventbrite', {
        daysAhead: 30,
        scrapeRunId,
      }),
      tasks.trigger<typeof scrapeBATourism>('scrape-ba-tourism', {
        scrapeRunId,
      }),
      tasks.trigger<typeof scrapeMeetup>('scrape-meetup', {
        daysAhead: 14,
        scrapeRunId,
      }),
      tasks.trigger<typeof scrapeLuma>('scrape-luma', {
        scrapeRunId,
      }),
      tasks.trigger<typeof scrapePassline>('scrape-passline', {
        daysAhead: 30,
        scrapeRunId,
      }),
      tasks.trigger<typeof scrapeVenti>('scrape-venti', {
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
        const error = describeFailedRunResult(runResult)

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

    // Clean up any events that match blocklist patterns
    // This handles events imported before blocklist entries were added
    console.log('[daily-scrape] Running blocklist cleanup...')
    const blocklistCleanup = await cleanupBlocklistedEvents(client)
    if (blocklistCleanup > 0) {
      console.log(`[daily-scrape] Blocklist cleanup: deleted ${blocklistCleanup} events`)
    } else {
      console.log('[daily-scrape] Blocklist cleanup: no events to delete')
    }

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
    const errorMessage = buildScrapeRunErrorMessage(results)
    const { error: updateError } = await client
      .from('scrape_runs')
      .update({
        status: hasErrors ? 'partial' : 'completed',
        completed_at: completedAt,
        error_message: errorMessage,
        events_fetched: totalInserted + totalUpdated + totalSkipped,
        events_inserted: totalInserted,
        events_updated: totalUpdated,
        events_skipped: totalSkipped,
        venues_auto_created: totalVenuesCreated,
        metadata: {
          ...scrapeRun.metadata,
          results,
          enrichmentTriggered,
          blocklistCleanup,
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
      blocklistCleanup,
    }
  },
})
