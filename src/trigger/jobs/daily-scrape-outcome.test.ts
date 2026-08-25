import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  mapBatchRunsToResults,
  summarizeResults,
  determineScrapeRunStatus,
  finalizeScrapeRun,
  reconcileStaleScrapeRuns,
  mergeEnrichmentMetadata,
  shouldChainNextBatch,
  recordEnrichmentAudit,
  type DailyScrapeResult,
} from './daily-scrape-outcome.ts'

const SOURCE_JOBS = [
  { id: 'scrape-passline', name: 'Passline' },
  { id: 'scrape-meetup', name: 'Meetup' },
  { id: 'scrape-eventbrite', name: 'Eventbrite' },
  { id: 'scrape-ba-tourism', name: 'BA Tourism' },
  { id: 'scrape-luma', name: 'Luma' },
  { id: 'scrape-venti', name: 'Venti' },
] as const

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
  it('maps runs to source results by taskIdentifier', () => {
    const results = mapBatchRunsToResults(
      [
        okRun('scrape-passline', { eventsInserted: 3, eventsUpdated: 1 }),
        okRun('scrape-meetup', { eventsInserted: 2 }),
        failRun('scrape-eventbrite', 'eventbrite down'),
        okRun('scrape-ba-tourism'),
        okRun('scrape-luma'),
        okRun('scrape-venti'),
      ],
      SOURCE_JOBS
    )

    expect(results).toHaveLength(6)
    expect(results[0]).toMatchObject({
      source: 'Passline',
      success: true,
      eventsInserted: 3,
      eventsUpdated: 1,
    })
    expect(results[2]).toMatchObject({
      source: 'Eventbrite',
      success: false,
      error: 'eventbrite down',
    })
  })

  it('marks a missing run as failed', () => {
    const results = mapBatchRunsToResults([okRun('scrape-passline')], SOURCE_JOBS)
    expect(results[1]).toMatchObject({ source: 'Meetup', success: false, error: 'No run produced' })
  })

  it('extracts a nested error object message', () => {
    const results = mapBatchRunsToResults(
      [failRun('scrape-passline', { message: 'nested failure' })],
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
    const updates: Array<Record<string, unknown>> = []
    const eq = vi.fn(() => Promise.resolve({ error: null }))
    const update = vi.fn((payload: Record<string, unknown>) => {
      updates.push(payload)
      return { eq }
    })
    const from = vi.fn(() => ({ update }))
    return { client: { from } as unknown as SupabaseClient, updates, eq }
  }

  it('writes status completed, completed_at and stats for a fully-successful run', async () => {
    const { client, updates, eq } = fakeFinalizeClient()
    const results = resultsFor([true, true])

    await finalizeScrapeRun(client, 'run-1', { scheduled: true }, results, true, 4, 37)

    expect(eq).toHaveBeenCalledWith('id', 'run-1')
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

  it('throws when the update returns an error', async () => {
    const eq = vi.fn(() => Promise.resolve({ error: { message: 'db constraint violated' } }))
    const update = vi.fn(() => ({ eq }))
    const client = { from: vi.fn(() => ({ update })) } as unknown as SupabaseClient

    await expect(
      finalizeScrapeRun(client, 'run-4', null, resultsFor([true]), false, 0, 0)
    ).rejects.toThrow('Failed to finalize scrape run: db constraint violated')
  })

  it('throws when the update rejects', async () => {
    const eq = vi.fn(() => Promise.reject(new Error('db down')))
    const update = vi.fn(() => ({ eq }))
    const client = { from: vi.fn(() => ({ update })) } as unknown as SupabaseClient

    await expect(
      finalizeScrapeRun(client, 'run-3', null, resultsFor([true]), false, 0, 0)
    ).rejects.toThrow('db down')
  })
})

describe('reconcileStaleScrapeRuns', () => {
  function fakeReconciliationClient(
    data: Array<{ id: string }> = [],
    error: { message: string } | null = null
  ) {
    const updates: Array<Record<string, unknown>> = []
    const select = vi.fn(() => Promise.resolve({ data, error }))
    const lt = vi.fn(() => ({ select }))
    const eq = vi.fn(() => ({ lt }))
    const update = vi.fn((payload: Record<string, unknown>) => {
      updates.push(payload)
      return { eq }
    })
    const from = vi.fn(() => ({ update }))

    return { client: { from } as unknown as SupabaseClient, updates, eq, lt }
  }

  it('marks only runs older than two hours as failed', async () => {
    const { client, updates, eq, lt } = fakeReconciliationClient([
      { id: 'stale-1' },
      { id: 'stale-2' },
    ])
    const now = new Date('2026-08-19T12:00:00.000Z')

    await expect(reconcileStaleScrapeRuns(client, now)).resolves.toBe(2)

    expect(eq).toHaveBeenCalledWith('status', 'running')
    expect(lt).toHaveBeenCalledWith('started_at', '2026-08-19T10:00:00.000Z')
    expect(updates[0]).toEqual({
      status: 'failed',
      completed_at: '2026-08-19T12:00:00.000Z',
      error_message: 'Run did not finalize before the two-hour stale cutoff',
      error_details: {
        reason: 'stale_running_run',
        reconciledAt: '2026-08-19T12:00:00.000Z',
      },
    })
  })

  it('throws when reconciliation fails', async () => {
    const { client } = fakeReconciliationClient([], { message: 'db unavailable' })

    await expect(reconcileStaleScrapeRuns(client)).rejects.toThrow(
      'Failed to reconcile stale scrape runs: db unavailable'
    )
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
    const updates: Array<Record<string, unknown>> = []
    const maybeSingle = vi.fn(() =>
      Promise.resolve({ data: existingMetadata === null ? null : { metadata: existingMetadata }, error: null })
    )
    const eqSelect = vi.fn(() => ({ maybeSingle }))
    const select = vi.fn(() => ({ eq: eqSelect }))

    const eqUpdate = vi.fn(() => Promise.resolve({ error: null }))
    const update = vi.fn((payload: Record<string, unknown>) => {
      updates.push(payload)
      return { eq: eqUpdate }
    })

    const from = vi.fn((table: string) => ({
      select,
      update,
    }))

    return { client: { from } as unknown as SupabaseClient, updates, eqUpdate }
  }

  it('merges the chain counts into the parent\'s eligible and updates columns', async () => {
    const { client, updates, eqUpdate } = fakeAuditClient({ eligible: 100 })

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
    expect(eqUpdate).toHaveBeenCalledWith('id', 'run-1')
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
    const maybeSingle = vi.fn(() =>
      Promise.resolve({ data: null, error: { message: 'read failed' } })
    )
    const eqSelect = vi.fn(() => ({ maybeSingle }))
    const select = vi.fn(() => ({ eq: eqSelect }))
    const client = { from: vi.fn(() => ({ select })) } as unknown as SupabaseClient
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      recordEnrichmentAudit(client, 'run-3', { enriched: 1 })
    ).resolves.toBeUndefined()
  })
})
