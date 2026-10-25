import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import type { SupabaseClient } from '@supabase/supabase-js'
import { collectInstagramEffect, type ApifyRequest } from './collection.ts'
import { commitPlanEffect } from './service.ts'
import { allRowsEffect } from './repository.ts'

/** Recorded SDK responses, with no real credentials, providers or database access. */
function fakeDb(responses: Array<{ data: unknown; error: { message: string } | null }>) {
  const calls: string[] = []
  const take = () => { const response = responses.shift(); if (!response) throw new Error('Unexpected database call'); return Promise.resolve(response) }
  const query = (): unknown => new Proxy({}, { get: (_target, name) => {
    if (name === 'then') return (resolve: (result: unknown) => void, reject: (error: unknown) => void) => take().then(resolve, reject)
    return () => query()
  } })
  const db = { from: (table: string) => { calls.push(`table:${table}`); return query() },
    rpc: (name: string) => { calls.push(`rpc:${name}`); return take() },
    storage: { from: (bucket: string) => ({ download: () => { calls.push(`download:${bucket}`); return take() },
      upload: () => { calls.push(`upload:${bucket}`); return take() } }) } } as unknown as SupabaseClient
  return { db, calls }
}
const ok = (data: unknown) => ({ data, error: null })
const error = (message: string) => ({ data: null, error: { message } })
const plan = { id: 'plan', action: 'create', candidate_id: 'candidate', revision: 1, receipt: null,
  artwork_media_id: 'media', payload: { embedding: Array(1536).fill(0.1) } }

describe('intake failure and retry orchestration', () => {
  it('fails a catalog read rather than treating a database outage as an empty catalog', async () => {
    const { db } = fakeDb([error('database unavailable')])
    await expect(Effect.runPromise(allRowsEffect(db, 'events', '*'))).rejects.toThrow('database unavailable')
  })
  it('does no preparation or publication for a disabled workflow', async () => {
    const { db, calls } = fakeDb([ok(plan), ok({ publishing_enabled: false })])
    await expect(Effect.runPromise(commitPlanEffect(db, 'plan'))).rejects.toThrow('disabled')
    expect(calls).toEqual(['table:intake_plans', 'table:intake_policy'])
  })
  it('rejects changed evidence before provider calls or public image uploads', async () => {
    const { db, calls } = fakeDb([ok(plan), ok({ publishing_enabled: true }), error('Source changed after review')])
    await expect(Effect.runPromise(commitPlanEffect(db, 'plan'))).rejects.toThrow('Source changed after review')
    expect(calls).not.toContain('upload:event-artwork')
  })
  it('retries artwork preparation even when a previous attempt already prepared its embedding', async () => {
    const media = { object_key: 'synthetic.jpg', content_type: 'image/jpeg' }
    const failed = fakeDb([ok(plan), ok({ publishing_enabled: true }), ok(true), ok(media), ok(new Blob(['synthetic'])), error('temporary storage failure')])
    await expect(Effect.runPromise(commitPlanEffect(failed.db, 'plan'))).rejects.toThrow('temporary storage failure')
    expect(failed.calls).not.toContain('rpc:commit_intake_plan')
    const retry = fakeDb([ok(plan), ok({ publishing_enabled: true }), ok(true), ok(media), ok(new Blob(['synthetic'])), ok({ path: 'synthetic.jpg' }), ok({ event_id: 'event', action: 'create' })])
    expect(await Effect.runPromise(commitPlanEffect(retry.db, 'plan'))).toEqual({ event_id: 'event', action: 'create' })
    expect(retry.calls).toContain('upload:event-artwork')
  })
  it('returns a receipt without repeating side effects', async () => {
    const receipt = { event_id: 'event', action: 'create' }
    const { db, calls } = fakeDb([ok({ ...plan, receipt })])
    expect(await Effect.runPromise(commitPlanEffect(db, 'plan'))).toEqual(receipt)
    expect(calls).toEqual(['table:intake_plans'])
  })
  it('keeps unknown admission out of free/paid search claims while preparing publication', async () => {
    const unprepared = { ...plan, artwork_media_id: null, payload: { name: 'Synthetic Jazz', price: null, is_free: false, venue_id: 'venue' } }
    const { db } = fakeDb([ok(unprepared), ok({ publishing_enabled: true }), ok(true),
      ok({ name: 'Synthetic Venue', neighborhood: 'Palermo' }), ok({ id: 'plan' }), ok({ action: 'create' })])
    const publishers = {
      embed: async (input: { is_free?: boolean }) => {
        expect(input.is_free).toBeUndefined()
        return { embedding: Array(1536).fill(0.1), searchDocument: 'Synthetic Jazz' }
      },
      presentation: async () => ({ description_display_es: null, description_display_en: null, description_summary_es: null, description_summary_en: null }),
    }
    expect(await Effect.runPromise(commitPlanEffect(db, 'plan', publishers))).toEqual({ action: 'create' })
  })
  it('never starts a second paid run after an uncertain start', async () => {
    const { db } = fakeDb([ok({ collection_enabled: true }), ok({ fresh: false, apify_run_id: null })])
    const api: ApifyRequest = async () => { throw new Error('No API call is allowed') }
    await expect(Effect.runPromise(collectInstagramEffect(db, api))).rejects.toThrow('unknown start outcome')
  })
  it('resumes an existing paid run without needing new credit', async () => {
    const { db } = fakeDb([ok({ collection_enabled: true }), ok({ fresh: false, apify_run_id: 'existing-run' })])
    const api: ApifyRequest = async (method, path) => {
      expect(method).toBe('GET'); expect(path).toBe('actor-runs/existing-run')
      return { data: { id: 'existing-run', status: 'RUNNING', defaultDatasetId: 'dataset' } }
    }
    expect(await Effect.runPromise(collectInstagramEffect(db, api))).toEqual({ state: 'running', run_id: 'existing-run' })
  })
})
