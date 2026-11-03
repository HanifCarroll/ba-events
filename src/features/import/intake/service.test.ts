import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import type { SupabaseClient } from '@supabase/supabase-js'
import { collectInstagramEffect, type ApifyRequest } from './collection.ts'
import { commitPlanEffect, readEvidenceEffect, previewCandidateEffect } from './service.ts'
import { decodeCandidate } from './schema.ts'
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
  it('loads media alongside observations and does not block the dependent source read on media', async () => {
    let releasePosts!: () => void
    let releaseMedia!: () => void
    const posts = new Promise<void>((resolve) => { releasePosts = resolve })
    const media = new Promise<void>((resolve) => { releaseMedia = resolve })
    const calls: string[] = []
    const query = (table: string): unknown => new Proxy({}, { get: (_target, method) => {
      if (method === 'then') return (resolve: (value: unknown) => void, reject: (error: unknown) => void) => (async () => {
        calls.push(table)
        if (table === 'intake_observations') { await posts; return ok([{ id: 'observation', source_username: 'synthetic' }]) }
        if (table === 'intake_media') { await media; return ok([{ id: 'media' }]) }
        return ok([{ username: 'synthetic', authority: 'venue' }])
      })().then(resolve, reject)
      return () => query(table)
    } })
    const db = { from: query } as unknown as SupabaseClient
    const running = Effect.runPromise(readEvidenceEffect(db, { evidence: [{ observation_id: 'observation' }] } as never))
    try {
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(calls).toEqual(['intake_observations', 'intake_media'])
      releasePosts()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(calls).toContain('instagram_sources')
    } finally { releasePosts(); releaseMedia() }
    expect(await running).toEqual({ observations: [{ id: 'observation', source_username: 'synthetic', authority: 'venue' }], media: [{ id: 'media' }] })
  })

  it('bounds concurrent freshness checks and never plans publication after a failed check', async () => {
    const posts = Array.from({ length: 6 }, (_, index) => ({ id: `30000000-0000-4000-8000-00000000000${index}`, post_id: `post-${index}`, source_username: 'synthetic', caption: 'Synthetic' }))
    const candidate = decodeCandidate({ id: '10000000-0000-4000-8000-000000000001', expected_revision: 0, intent: 'create', target_event_id: null,
      name: 'Synthetic', date: '2026-11-20', time: null, venue_name: null, venue_id: null,
      description_es: null, description_en: null, categories: ['music'], status: 'scheduled', price_kind: 'unknown',
      price_ars: null, price_note: null, ticket_url: null, artwork_media_id: null, issues: [], notes: '',
      evidence: posts.map(post => ({ observation_id: post.id, fields: ['name', 'date', 'venue'], excerpt: 'Synthetic', media_id: null })),
    })
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let checks = 0
    const tables: string[] = []
    const query = (table: string, columns = '*'): unknown => new Proxy({}, { get: (_target, method) => {
      if (method === 'then') return (resolve: (value: unknown) => void, reject: (error: unknown) => void) => (async () => {
        if (table === 'intake_candidates') return ok({ revision: 0, payload: candidate })
        if (table === 'instagram_sources') return ok([{ username: 'synthetic', authority: 'venue' }])
        if (table === 'intake_media') return ok([])
        if (columns === '*') return ok(posts)
        checks++; await gate; return error('Synthetic freshness outage')
      })().then(resolve, reject)
      return (value: string) => query(table, method === 'select' ? value : columns)
    } })
    const db = { from: (table: string) => { tables.push(table); return query(table) } } as unknown as SupabaseClient
    const running = Effect.runPromise(previewCandidateEffect(db, candidate.id, 'https://example.supabase.co', new Date('2026-10-25')))
    const outcome = running.then(() => null, (failure: Error) => failure)
    try {
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(checks).toBe(4)
    } finally { release() }
    expect((await outcome)?.message).toContain('Synthetic freshness outage')
    expect(checks).toBe(4)
    expect(tables).not.toContain('intake_plans')
  })

  it('overlaps publication preparation but waits for both results before writing', async () => {
    const unprepared = { ...plan, artwork_media_id: null, payload: { name: 'Synthetic Jazz', venue_id: 'venue' } }
    const { db, calls } = fakeDb([ok(unprepared), ok({ publishing_enabled: true }), ok(true),
      ok({ name: 'Synthetic Venue', neighborhood: 'Palermo' }), ok({ id: 'plan' }), ok({ action: 'create' })])
    const started: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const running = Effect.runPromise(commitPlanEffect(db, 'plan', {
      embed: async () => { started.push('embedding'); await gate; return { embedding: Array(1536).fill(0.1), searchDocument: 'Synthetic Jazz' } },
      presentation: async () => { started.push('presentation'); await gate; return { description_display_es: null, description_display_en: null, description_summary_es: null, description_summary_en: null } },
    }))
    try {
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(started).toEqual(['embedding', 'presentation'])
      expect(calls.filter(call => call === 'table:intake_plans')).toHaveLength(1)
      expect(calls).not.toContain('rpc:commit_intake_plan')
    } finally { release() }
    expect(await running).toEqual({ action: 'create' })
  })

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
