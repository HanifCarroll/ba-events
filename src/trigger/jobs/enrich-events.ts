/**
 * Event Enrichment Job
 *
 * Enriches events that have pending enrichment status.
 * - Fetches event descriptions from source pages
 * - Generates bilingual descriptions
 * - Updates embeddings
 *
 * Chaining: a run drains all PENDING events created by a single daily import
 * via sequential, bounded batches. After each batch the job re-counts the
 * pending events that remain (scoped to the same `createdAfter`) and — only
 * after the current batch fully completes — triggers the next batch. Batches
 * never overlap, so two batches can never pick up the same event.
 *
 * Failure-loop guard: the chain only ever selects `pending` rows. A row that
 * fails enrichment is marked `failed` and therefore leaves the pending set, so
 * it cannot be re-selected by a later batch in the same chain and starve later
 * rows. It stays `failed` (retryable) and is picked up by the 10:00 catch-up
 * job — which is the designated retry path. `skipped`/`canceled` rows are
 * terminal and also leave the pending set. The chain is capped at
 * `maxBatches * limit` events (default 1000) as a safety ceiling.
 */
import { task, tasks, metadata } from '@trigger.dev/sdk/v3'
import { createServiceRoleClient } from '../utils/db-client.ts'
import {
  enrichEvents,
  getEventsNeedingEnrichment,
  countEventsNeedingEnrichment,
  type EnrichmentStats,
} from '#features/import/core/event-enrichment.ts'
import { recordEnrichmentAudit, shouldChainNextBatch } from './daily-scrape-outcome.ts'

export interface EnrichEventsJobPayload {
  /** Events to enrich per batch (default: 100) */
  limit?: number
  /** Source to filter events (optional) */
  source?: string
  /** Only enrich events created after this date (ISO string) */
  createdAfter?: string
  /** Which batch in the chain this run is (1-based, default: 1) */
  batchNumber?: number
  /** Maximum batches in this chain (safety ceiling, default: 10 → 1000 events) */
  maxBatches?: number
  /** Daily scrape run id to write the final audit counts back to */
  scrapeRunId?: string
  /** Total eligible events at chain start (computed by the daily-scrape parent) */
  eligible?: number
  /** Cumulative enriched count carried from prior batches in this chain */
  enrichedSoFar?: number
  /** Cumulative failed count carried from prior batches in this chain */
  failedSoFar?: number
}

export interface EnrichEventsJobResult extends EnrichmentStats {
  batchNumber: number
  eligible: number
  enrichedSoFar: number
  failedSoFar: number
  /** Unattempted pending rows after this batch (drives chaining). */
  pendingRemaining: number
  /** Final audit remaining: eligible rows still needing enrichment after the
   * chain (failures + any unattempted rows at the safety ceiling). Set on the
   * final batch. */
  remainingCount: number
  chainedNextBatch: boolean
}

export const DEFAULT_ENRICHMENT_BATCH_SIZE = 100
export const DEFAULT_ENRICHMENT_MAX_BATCHES = 10 // 1000-event safety ceiling

export const enrichEventsJob = task({
  id: 'enrich-events',
  // Enrichment is slow (1 second per event + API calls); each batch is its own
  // run, so this budget applies per batch, not to the whole chain.
  maxDuration: 1800, // 30 minutes
  run: async (payload: EnrichEventsJobPayload): Promise<EnrichEventsJobResult> => {
    console.log('[enrich-events] Starting event enrichment job')

    const client = createServiceRoleClient()
    const limit = payload.limit ?? DEFAULT_ENRICHMENT_BATCH_SIZE
    const batchNumber = payload.batchNumber ?? 1
    const maxBatches = payload.maxBatches ?? DEFAULT_ENRICHMENT_MAX_BATCHES
    const enrichedSoFar = payload.enrichedSoFar ?? 0
    const failedSoFar = payload.failedSoFar ?? 0

    // Get PENDING events needing enrichment (scoped to this import's
    // createdAfter). `pending`-only: failed rows are retried by the catch-up
    // job, not re-selected here (see the failure-loop guard above).
    const events = await getEventsNeedingEnrichment(client, {
      source: payload.source,
      limit,
      createdAfter: payload.createdAfter,
      statuses: ['pending'],
    })

    if (events.length === 0) {
      console.log('[enrich-events] No pending events need enrichment')
      // Terminal batch with nothing to do: record the carried totals and the
      // still-eligible (pending + failed) remainder so the audit row always
      // gets a final write when a chain was started.
      const remainingCount = await countEventsNeedingEnrichment(client, {
        source: payload.source,
        createdAfter: payload.createdAfter,
      })
      if (payload.scrapeRunId) {
        await recordEnrichmentAudit(client, payload.scrapeRunId, {
          eligible: payload.eligible ?? 0,
          enriched: enrichedSoFar,
          failed: failedSoFar,
          remaining: remainingCount,
        })
      }
      return {
        total: 0,
        enriched: 0,
        skipped: 0,
        failed: 0,
        canceled: 0,
        errors: [],
        batchNumber,
        eligible: payload.eligible ?? 0,
        enrichedSoFar,
        failedSoFar,
        pendingRemaining: 0,
        remainingCount,
        chainedNextBatch: false,
      }
    }

    console.log(`[enrich-events] Found ${events.length} pending events to enrich (batch ${batchNumber})`)

    // Set initial metadata for frontend progress tracking
    metadata.set('progress', {
      batchNumber,
      current: 0,
      total: events.length,
      enriched: 0,
      failed: 0,
      canceled: 0,
      venuesMatched: 0,
      venuesCreated: 0,
      currentEvent: events[0]?.name ?? null,
    })

    // Track stats for metadata updates
    let enrichedCount = 0
    let failedCount = 0
    let canceledCount = 0
    let venuesMatched = 0
    let venuesCreated = 0

    // Process with progress logging and metadata updates
    const stats = await enrichEvents(client, events, {
      concurrency: 4,
      delayMs: 0,
      onProgress: (current, total, result) => {
        // Update counts
        if (result.canceled) {
          canceledCount++
        } else if (result.enriched) {
          enrichedCount++
        } else if (!result.success) {
          failedCount++
        }

        // Track venue settlements
        if (result.venueSettlement) {
          if (result.venueSettlement.action === 'matched' || result.venueSettlement.action === 'queued-review') {
            venuesMatched++
          } else if (result.venueSettlement.action === 'auto-created') {
            venuesCreated++
          }
        }

        // Find current event name for display
        const currentEventName = events.find((event) => event.id === result.eventId)?.name ?? null

        // Update metadata for real-time frontend updates
        metadata.set('progress', {
          batchNumber,
          current,
          total,
          enriched: enrichedCount,
          failed: failedCount,
          canceled: canceledCount,
          venuesMatched,
          venuesCreated,
          currentEvent: currentEventName,
        })

        // Console logging (every 10 or at completion)
        if (current % 10 === 0 || current === total) {
          console.log(`[enrich-events] Batch ${batchNumber} progress: ${current}/${total} (venues: ${venuesMatched} matched, ${venuesCreated} created, ${canceledCount} canceled)`)
        }
        if (result.canceled) {
          console.log(`[enrich-events] Event page gone, marked as canceled: ${result.eventId}`)
        } else if (!result.success) {
          console.warn(`[enrich-events] Failed: ${result.eventId} - ${result.error}`)
        }
      },
    })

    // Count UNATTEMPTED pending rows remaining in this import's scope AFTER
    // this batch fully completed. Failed rows are excluded (they are no longer
    // pending), so a row this chain already attempted — whether it failed,
    // skipped, canceled, or succeeded — never keeps the chain alive.
    const pendingRemaining = await countEventsNeedingEnrichment(client, {
      source: payload.source,
      createdAfter: payload.createdAfter,
      statuses: ['pending'],
    })

    const totalEnriched = enrichedSoFar + stats.enriched
    const totalFailed = failedSoFar + stats.failed
    // `eligible` is authoritative from the daily-scrape parent.
    const eligible = payload.eligible ?? 0

    const chainedNextBatch = shouldChainNextBatch(pendingRemaining, batchNumber, maxBatches)

    let remainingCount = 0
    if (chainedNextBatch) {
      console.log(
        `[enrich-events] Batch ${batchNumber} done (${stats.enriched} enriched, ${stats.failed} failed, ${pendingRemaining} pending remaining). Triggering batch ${batchNumber + 1}`
      )
      await tasks.trigger<typeof enrichEventsJob>('enrich-events', {
        limit,
        source: payload.source,
        createdAfter: payload.createdAfter,
        batchNumber: batchNumber + 1,
        maxBatches,
        scrapeRunId: payload.scrapeRunId,
        eligible,
        enrichedSoFar: totalEnriched,
        failedSoFar: totalFailed,
      })
    } else {
      // Final batch in the chain (drained or hit the safety ceiling).
      // `remaining` = eligible rows still needing enrichment after the chain:
      // the failures from this chain plus any unattempted rows left over at the
      // safety ceiling. Both are picked up by the 10:00 catch-up.
      remainingCount = await countEventsNeedingEnrichment(client, {
        source: payload.source,
        createdAfter: payload.createdAfter,
      })
      if (payload.scrapeRunId) {
        await recordEnrichmentAudit(client, payload.scrapeRunId, {
          eligible,
          enriched: totalEnriched,
          failed: totalFailed,
          remaining: remainingCount,
        })
      }
    }

    console.log(
      `[enrich-events] Batch ${batchNumber} completed:`,
      { eligible, enriched: totalEnriched, failed: totalFailed, pendingRemaining, remaining: remainingCount, chainedNextBatch }
    )

    return {
      ...stats,
      batchNumber,
      eligible,
      enrichedSoFar: totalEnriched,
      failedSoFar: totalFailed,
      pendingRemaining,
      remainingCount,
      chainedNextBatch,
    }
  },
})
