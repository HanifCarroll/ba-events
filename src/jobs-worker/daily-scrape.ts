/**
 * Daily scrape orchestration (06:00 Buenos Aires).
 *
 * Each source is its own retried Workflow step, so one failing source does not
 * fail the others. The `scrape_runs` row, blocklist cleanup, and the eligible
 * count keep the shape the Trigger.dev job wrote.
 */
import type { CatalogStore } from '#features/import/core/catalog-store.ts'
import { pruneAcquisitionCache } from '#features/import/acquisition/cache.ts'
import { countEventsNeedingEnrichment } from '#features/import/core/event-enrichment.ts'
import {
  finalizeScrapeRun,
  reconcileStaleScrapeRuns,
  type BatchRunLike,
} from './daily-scrape-outcome.ts'

export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now()
  try {
    return await fn()
  } finally {
    console.log(`[daily-scrape] ${label}: ${Math.round(performance.now() - start)}ms`)
  }
}

/** Create the audit row after closing any earlier run that never finalized. */
export async function openScrapeRun(catalog: CatalogStore, workflowRunId: string, scheduledTime: string | null): Promise<{ id: string; metadata: unknown; startedAt: string }> {
  await pruneAcquisitionCache().catch(() => console.warn('[daily-scrape] Cache retention unavailable'))
  const startedAt = new Date().toISOString()
  try {
    const reconciled = await timed('stale-run reconciliation', () => reconcileStaleScrapeRuns(catalog, new Date(startedAt)))
    if (reconciled > 0) console.warn(`[daily-scrape] Reconciled ${reconciled} stale scrape run(s)`)
  } catch (error) {
    console.error('[daily-scrape] Failed to reconcile stale scrape runs:', error)
  }
  const data = await catalog.createScrapeRun({ source: 'all', status: 'running', trigger_id: workflowRunId, metadata: { scheduledTime } })
  console.log(`[daily-scrape] Created scrape run: ${data.id}`)
  return { id: data.id, metadata: data.metadata, startedAt }
}

/** Blocklist cleanup, eligible count, and the final audit write. Returns the eligible count. */
export async function closeScrapeRun(
  catalog: CatalogStore,
  run: { id: string; metadata: unknown; startedAt: string },
  outcomes: BatchRunLike[],
  results: Parameters<typeof finalizeScrapeRun>[3]
): Promise<number> {
  for (const outcome of outcomes) if (!outcome.ok) console.error(`[daily-scrape] ${outcome.taskIdentifier} failed:`, outcome.error)
  let blocklistCleanup = 0
  let eligible = 0
  try {
    blocklistCleanup = await timed('blocklist cleanup', () => cleanupBlocklistedEvents(catalog))
    if (blocklistCleanup > 0) console.log(`[daily-scrape] Blocklist cleanup: deleted ${blocklistCleanup} events`)
    eligible = await timed('enrichment eligible count', () => countEventsNeedingEnrichment(catalog, { createdAfter: run.startedAt }))
  } finally {
    await finalizeScrapeRun(catalog, run.id, run.metadata, results, eligible > 0, blocklistCleanup, eligible)
  }
  return eligible
}

/**
 * Clean up existing events that match blocklist patterns.
 * This handles events imported before blocklist entries were added.
 */
async function cleanupBlocklistedEvents(catalog: CatalogStore): Promise<number> {
  let blocklistEntries
  let events
  try {
    blocklistEntries = await catalog.blocklistEntries()
    if (blocklistEntries.length === 0) return 0
    events = await catalog.blocklistCandidates()
  } catch (error) {
    console.error('[daily-scrape] Failed to fetch events for blocklist cleanup:', error)
    return 0
  }

  const eventIdsToDelete: string[] = []

  for (const event of events) {
    const lowerEventName = event.name?.toLowerCase() || ''
    const lowerVenueName = event.venue_name?.toLowerCase() || ''

    for (const entry of blocklistEntries) {
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

  try {
    await catalog.deleteEvents(eventIdsToDelete)
  } catch (deleteError) {
    console.error('[daily-scrape] Failed to delete blocklisted events:', deleteError)
    return 0
  }

  return eventIdsToDelete.length
}
