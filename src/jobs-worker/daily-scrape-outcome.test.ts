import type { CatalogStore, ScrapeRunPatch } from '#features/import/core/catalog-store.ts'
import { describe, expect, it, vi } from 'vitest'
import { catalogImportProvenance, CATALOG_IMPORT_VERSION } from '#features/import/core/enrichment-provenance.ts'
import {
  mapBatchRunsToResults,
  summarizeResults,
  determineScrapeRunStatus,
  finalizeScrapeRun,
  reconcileStaleScrapeRuns,
  mergeEnrichmentMetadata,
  shouldChainNextBatch,
  recordEnrichmentAudit,
  importAllSources,
  sourceRetryDelay,
  RATE_LIMIT_DEFAULT_SECONDS,
  type DailyScrapeResult,
} from './daily-scrape-outcome.ts'

import { SOURCES as SOURCE_JOBS } from './source-health.ts'
import { LumaRateLimitError } from '#features/import/scrapers/luma/http.ts'

const okRun = (taskIdentifier: string, stats: Record<string, number> = {}) => ({
  taskIdentifier,
  ok: true,
  output: {
    eventsInserted: 0,
    eventsUpdated: 0,
    eventsSkipped: 0,
    venuesAutoCreated: 0,
    ...stats,
  },
})

const failRun = (taskIdentifier: string, error: unknown = 'boom') => ({
  taskIdentifier,
  ok: false,
  error,
})

function resultsFor(success: boolean[]): DailyScrapeResult['results'] {
  return success.map((ok, i) => ({
    source: `source-${i}`,
    success: ok,
    eventsInserted: 0,
    eventsUpdated: 0,
    eventsSkipped: 0,
    venuesAutoCreated: 0,
    ...(ok ? {} : { error: 'failure' }),
  }))
}

describe('mapBatchRunsToResults', () => {
  it('retains catalog observation/version receipts and leaves legacy outputs unmeasured', () => {
    const provenance = catalogImportProvenance('2026-10-01T10:00:00.000Z')
    const runs = SOURCE_JOBS.map((job, index) => ({
      ...okRun(job.id),
      output: { ...okRun(job.id).output, ...(index === 0 ? { catalogProvenance: provenance } : {}) },
    }))
    const results = mapBatchRunsToResults(runs, SOURCE_JOBS)
    expect(results[0].catalogProvenance).toEqual(provenance)
    expect(results[0].catalogProvenance?.version).toBe(CATALOG_IMPORT_VERSION)
    expect(results[0].catalogProvenance?.scope).toBe('catalog')
    expect(results[1]).not.toHaveProperty('catalogProvenance')
  })
  it('maps source step outcomes to source results by id', () => {
    const results = mapBatchRunsToResults(
      [
        okRun('meetup', { eventsInserted: 3, eventsUpdated: 1, eventsFetched: 100, eventsFiltered: 80, eventsUnchanged: 76, categorizationSuccessful: 3, categorizationFallback: 0 }),
        failRun('ba-tourism', 'ba tourism down'),
        okRun('luma', { eventsInserted: 2 }),
      ],
      SOURCE_JOBS
    )

    expect(results).toHaveLength(3)
    expect(results[0]).toMatchObject({
      source: 'Meetup',
      success: true,
      eventsInserted: 3,
      eventsUpdated: 1,
      eventsFetched: 100, eventsFiltered: 80, eventsUnchanged: 76,
      categorizationSuccessful: 3, categorizationFallback: 0,
    })
    expect(results[1]).toMatchObject({
      source: 'BA Tourism',
      success: false,
      error: 'ba tourism down',
    })
    expect(results[2].eventsFetched).toBeNull()
  })

  it('marks a missing outcome as failed', () => {
    const results = mapBatchRunsToResults([okRun('meetup')], SOURCE_JOBS)
    expect(results[1]).toMatchObject({ source: 'BA Tourism', success: false, error: 'No run produced' })
  })

  it('extracts a nested error object message', () => {
    const results = mapBatchRunsToResults(
      [failRun('meetup', { message: 'nested failure' })],
      SOURCE_JOBS
    )
    expect(results[0].error).toBe('nested failure')
  })
})

describe('summarizeResults', () => {
  it('aggregates inserted/updated/skipped/venue stats', () => {
    const results: DailyScrapeResult['results'] = [
      { source: 'a', success: true, eventsInserted: 1, eventsUpdated: 2, eventsSkipped: 3, venuesAutoCreated: 4 },
      { source: 'b', success: true, eventsInserted: 5, eventsUpdated: 6, eventsSkipped: 7, venuesAutoCreated: 8 },
    ]
    expect(summarizeResults(results)).toEqual({
      inserted: 6,
      updated: 8,
      skipped: 10,
      venuesCreated: 12,
    })
  })
})

describe('determineScrapeRunStatus', () => {
  it('returns completed when all sources succeeded', () => {
    expect(determineScrapeRunStatus(resultsFor([true, true, true]))).toBe('completed')
  })

  it('returns failed when all sources failed', () => {
    expect(determineScrapeRunStatus(resultsFor([false, false]))).toBe('failed')
  })

  it('returns partial when some sources succeeded and some failed', () => {
    expect(determineScrapeRunStatus(resultsFor([true, false, true]))).toBe('partial')
  })

  it('returns failed for an empty result set', () => {
    expect(determineScrapeRunStatus([])).toBe('failed')
  })
})

describe('finalizeScrapeRun', () => {
  function fakeFinalizeClient() {
    const updates: ScrapeRunPatch[] = []
    const updateScrapeRun = vi.fn<CatalogStore['updateScrapeRun']>(async (_, patch) => { updates.push(patch) })
    return { client: { updateScrapeRun } as unknown as CatalogStore, updates, updateScrapeRun }
  }

  it('writes status completed, completed_at and stats for a fully-successful run', async () => {
    const { client, updates, updateScrapeRun } = fakeFinalizeClient()
    const results = resultsFor([true, true])
    results[0].catalogProvenance = catalogImportProvenance('2026-10-01T10:00:00.000Z')

    await finalizeScrapeRun(client, 'run-1', { scheduled: true }, results, true, 4, 37)

    expect(updateScrapeRun).toHaveBeenCalledWith('run-1', expect.any(Object))
    const payload = updates[0]
    expect(payload.status).toBe('completed')
    expect(payload.completed_at).toBeTruthy()
    expect(payload.error_message).toBeNull()
    expect(payload.events_fetched).toBe(0)
    expect(payload.metadata).toMatchObject({
      scheduled: true,
      enrichmentTriggered: true,
      blocklistCleanup: 4,
      enrichment: { eligible: 37 },
      results: [{ ...results[0] }, { ...results[1] }],
      sourceHealth: { version: 'source-health-v1', freshnessLimitHours: 36, enrichment: { eligible: 37, enriched: null, failed: null, remaining: null } },
    })
  })

  it('writes status failed for an all-failed run with an error message', async () => {
    const { client, updates } = fakeFinalizeClient()
    await finalizeScrapeRun(client, 'run-2', null, resultsFor([false, false]), false, 0, 0)

    expect(updates[0].status).toBe('failed')
    expect(updates[0].completed_at).toBeTruthy()
    expect(updates[0].error_message).toBe('source-0: failure; source-1: failure')
    expect(updates[0].metadata).toMatchObject({ enrichment: { eligible: 0 } })
  })

  it('throws when the update rejects', async () => {
    const client = { updateScrapeRun: async () => { throw new Error('db down') } } as unknown as CatalogStore
    await expect(finalizeScrapeRun(client, 'run-3', null, resultsFor([true]), false, 0, 0)).rejects.toThrow('db down')
  })
})

describe('reconcileStaleScrapeRuns', () => {
  it('marks runs older than two hours as failed', async () => {
    const failStaleScrapeRuns = vi.fn<CatalogStore['failStaleScrapeRuns']>(async () => 2)
    const client = { failStaleScrapeRuns } as unknown as CatalogStore
    await expect(reconcileStaleScrapeRuns(client, new Date('2026-08-19T12:00:00.000Z'))).resolves.toBe(2)
    expect(failStaleScrapeRuns).toHaveBeenCalledWith('2026-08-19T10:00:00.000Z', {
      status: 'failed', completed_at: '2026-08-19T12:00:00.000Z',
      error_message: 'Run did not finalize before the two-hour stale cutoff',
      error_details: { reason: 'stale_running_run', reconciledAt: '2026-08-19T12:00:00.000Z' },
    })
  })

  it('throws when reconciliation fails', async () => {
    const client = { failStaleScrapeRuns: async () => { throw new Error('db unavailable') } } as unknown as CatalogStore
    await expect(reconcileStaleScrapeRuns(client)).rejects.toThrow('db unavailable')
  })
})

describe('mergeEnrichmentMetadata', () => {
  it('patches over a null/undefined base', () => {
    expect(mergeEnrichmentMetadata(null, { eligible: 5 })).toEqual({ eligible: 5 })
  })

  it('preserves existing eligible when patching the chain counts', () => {
    const merged = mergeEnrichmentMetadata({ eligible: 100 }, {
      enriched: 90,
      failed: 3,
      remaining: 7,
    })
    expect(merged).toEqual({ eligible: 100, enriched: 90, failed: 3, remaining: 7 })
  })

})

describe('shouldChainNextBatch', () => {
  it('chains while events remain and the ceiling is not reached', () => {
    expect(shouldChainNextBatch(50, 3, 10)).toBe(true)
  })

  it('stops when nothing remains', () => {
    expect(shouldChainNextBatch(0, 3, 10)).toBe(false)
  })

  it('stops at the safety ceiling even when events remain', () => {
    expect(shouldChainNextBatch(500, 10, 10)).toBe(false)
  })
})

describe('recordEnrichmentAudit', () => {
  function fakeAuditClient(existingMetadata: unknown = null) {
    const updates: ScrapeRunPatch[] = []
    const updateScrapeRun = vi.fn<CatalogStore['updateScrapeRun']>(async (_, patch) => { updates.push(patch) })
    return { client: { scrapeRunMetadata: async () => existingMetadata, updateScrapeRun } as unknown as CatalogStore, updates, updateScrapeRun }
  }

  it('merges the chain counts into the parent\'s eligible and updates columns', async () => {
    const { client, updates, updateScrapeRun } = fakeAuditClient({ eligible: 100 })

    await recordEnrichmentAudit(client, 'run-1', {
      eligible: 100,
      enriched: 90,
      failed: 3,
      remaining: 7,
    })

    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({
      enrichments_completed: 90,
      enrichments_failed: 3,
      metadata: {
        eligible: 100,
        enrichment: { eligible: 100, enriched: 90, failed: 3, remaining: 7 },
      },
    })
    expect(updateScrapeRun).toHaveBeenCalledWith('run-1', expect.any(Object))
  })

  it('writes a fresh enrichment object when no metadata exists yet', async () => {
    const { client, updates } = fakeAuditClient(null)

    await recordEnrichmentAudit(client, 'run-2', { enriched: 1, failed: 0, remaining: 0 })

    expect(updates[0].metadata).toEqual({
      enrichment: { enriched: 1, failed: 0, remaining: 0 },
    })
    expect(updates[0].enrichments_completed).toBe(1)
    expect(updates[0].enrichments_failed).toBe(0)
  })

  it('does not throw when the read fails (best-effort audit)', async () => {
    const client = { scrapeRunMetadata: async () => { throw new Error('read failed') } } as unknown as CatalogStore
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      recordEnrichmentAudit(client, 'run-3', { enriched: 1 })
    ).resolves.toBeUndefined()
  })
})

describe('importAllSources', () => {
  /** Fake Workflow step: real per-attempt timeout, `limit` retries, no backoff wait. */
  function fakeStep(timeoutMs: number) {
    const attempts: Record<string, number> = {}
    const waits: Record<string, string[]> = {}
    const step = {
      async do<T>(name: string, config: { retries: { limit: number; delay: (input: { ctx: { attempt: number }; error: Error }) => string } }, callback: () => Promise<T>): Promise<T> {
        for (let attempt = 0; ; attempt++) {
          attempts[name] = attempt + 1
          let timer: ReturnType<typeof setTimeout> | undefined
          try {
            return await Promise.race([callback(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${name} timed out`)), timeoutMs) })])
          } catch (error) {
            if (attempt >= config.retries.limit) throw error
            // Record the wait Workflows would apply; don't sleep it.
            ;(waits[name] ??= []).push(config.retries.delay({ ctx: { attempt: attempt + 1 }, error: error as Error }))
          } finally {
            clearTimeout(timer)
          }
        }
      },
    }
    return { step, attempts, waits }
  }

  it('lets the other sources and finalization run when one source times out on every attempt', async () => {
    const { step, attempts } = fakeStep(20)
    const finished: string[] = []
    const outcomes = await importAllSources(step, SOURCE_JOBS, () => '30 minutes', async (id) => {
      if (id === 'meetup') return new Promise(() => {}) // hangs forever
      finished.push(id)
      return { eventsInserted: 1 }
    })
    const results = mapBatchRunsToResults(outcomes, SOURCE_JOBS)

    expect(attempts['import meetup']).toBe(3)
    expect(finished.sort()).toEqual(['ba-tourism', 'luma'])
    expect(results.map(result => [result.source, result.success])).toEqual([['Meetup', false], ['BA Tourism', true], ['Luma', true]])
    expect(results[0].error).toBe('import meetup timed out')
    expect(determineScrapeRunStatus(results)).toBe('partial')
  })

  it('starts every source before any finishes, so a slow source does not delay the rest', async () => {
    const { step } = fakeStep(1000)
    const started: string[] = []
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const running = importAllSources(step, SOURCE_JOBS, () => '30 minutes', async (id) => { started.push(id); await gate; return {} })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(started).toEqual(['meetup', 'ba-tourism', 'luma'])
    release()
    expect((await running).every(outcome => outcome.ok)).toBe(true)
  })

  it('waits minutes on a Luma 429, honoring Retry-After, while other errors keep the 1 s backoff', async () => {
    const { step, attempts, waits } = fakeStep(1000)
    const tries: Record<string, number> = {}
    const outcomes = await importAllSources(step, SOURCE_JOBS, () => '1 hour', async (id) => {
      tries[id] = (tries[id] ?? 0) + 1
      if (id === 'luma') {
        if (tries[id] === 1) throw new LumaRateLimitError(null)
        if (tries[id] === 2) throw new LumaRateLimitError(120)
        return { eventsFetched: 14 }
      }
      if (id === 'meetup' && tries[id] === 1) throw new Error('page crashed')
      return {}
    })
    expect(outcomes.every(outcome => outcome.ok)).toBe(true)
    expect(attempts['import luma']).toBe(3)
    expect(waits['import luma']).toEqual([`${RATE_LIMIT_DEFAULT_SECONDS} seconds`, '120 seconds'])
    expect(waits['import meetup']).toEqual(['1 seconds'])
  })
})

describe('sourceRetryDelay', () => {
  const delay = (attempt: number, message: string) => sourceRetryDelay({ ctx: { attempt }, error: new Error(message) })
  it('backs off in minutes for a rate limit without Retry-After', () => {
    expect(delay(1, 'Luma rate limited (429)')).toBe('300 seconds')
    expect(delay(2, 'Luma rate limited (429)')).toBe('600 seconds')
  })
  it('honors Retry-After, clamped to 30 s .. 30 min', () => {
    expect(delay(1, 'Luma rate limited (429); retry after 90s')).toBe('90 seconds')
    expect(delay(1, 'Luma rate limited (429); retry after 0s')).toBe('30 seconds')
    expect(delay(2, 'Luma rate limited (429); retry after 7200s')).toBe('1800 seconds')
  })
  it('keeps the 1 s exponential backoff for other errors', () => {
    expect(delay(1, 'boom')).toBe('1 seconds')
    expect(delay(2, 'boom')).toBe('2 seconds')
  })
})
