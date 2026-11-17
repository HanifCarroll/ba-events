import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import type { SupabaseClient } from '@supabase/supabase-js'
import { collectInstagramEffect, type ApifyRequest } from './collection.ts'
import { commitPlanEffect, readEvidenceEffect, previewCandidateEffect } from './service.ts'
import { decodeCandidate } from './schema.ts'
import { allRowsEffect } from './repository.ts'
import { ImportOperationError } from '../core/effect-utils.ts'
import { supabaseIntake } from './store-supabase.ts'

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
  return { db: supabaseIntake(db), client: db, calls }
}
const ok = (data: unknown) => ({ data, error: null })
const error = (message: string) => ({ data: null, error: { message } })
const plan = { id: 'plan', action: 'create', candidate_id: 'candidate', revision: 1, receipt: null, evidence: [],
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
    const running = Effect.runPromise(readEvidenceEffect(supabaseIntake(db), { evidence: [{ observation_id: 'observation' }] } as never))
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
    const running = Effect.runPromise(previewCandidateEffect(supabaseIntake(db, 'https://example.supabase.co'), candidate.id, new Date('2026-10-25')))
    const outcome = running.then(() => null, (failure: Error) => failure)
    try {
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(checks).toBe(4)
    } finally { release() }
    expect((await outcome)?.message).toContain('Synthetic freshness outage')
    expect(checks).toBe(4)
    expect(tables).not.toContain('intake_plans')
  })

  it('previews a candidate whose venue lookup fails as held, with no venue and no venue hint', async () => {
    const post = { id: '30000000-0000-4000-8000-000000000001', post_id: 'post-1', source_username: 'synthetic', caption: 'Synthetic', media_urls: [] }
    const candidate = decodeCandidate({ id: '10000000-0000-4000-8000-000000000002', expected_revision: 0, intent: 'create', target_event_id: null,
      name: 'Synthetic', date: '2026-11-20', time: null, venue_name: 'Sala Sintética', venue_id: null,
      description_es: null, description_en: null, categories: ['music'], status: 'scheduled', price_kind: 'unknown',
      price_ars: null, price_note: null, ticket_url: null, artwork_media_id: null, issues: [], notes: '',
      evidence: [{ observation_id: post.id, fields: ['name', 'date', 'venue'], excerpt: 'Synthetic', media_id: null }],
    })
    const inserted: Array<Record<string, unknown>> = []
    const rpcs: string[] = []
    const query = (table: string, columns = '*'): unknown => new Proxy({}, { get: (_target, method) => {
      if (method === 'then') return (resolve: (value: unknown) => void, reject: (error: unknown) => void) => (async () => {
        if (table === 'intake_candidates') return ok({ revision: 0, payload: candidate })
        if (table === 'instagram_sources') return ok([{ username: 'synthetic', authority: 'venue' }])
        if (table === 'intake_observations') return ok(columns === '*' ? [post] : [{ id: post.id }])
        if (table === 'intake_plans') return ok({ id: 'plan', ...inserted.at(-1) })
        return ok([])
      })().then(resolve, reject)
      if (method === 'insert') return (row: Record<string, unknown>) => { inserted.push(row); return query(table, columns) }
      return (value: string) => query(table, method === 'select' ? value : columns)
    } })
    const db = { from: (table: string) => query(table),
      rpc: async (name: string) => { rpcs.push(name); return error('function venues_named does not exist') } } as unknown as SupabaseClient
    const preview = await Effect.runPromise(previewCandidateEffect(supabaseIntake(db, 'https://example.supabase.co'), candidate.id, new Date('2026-10-25')))
    expect(rpcs).toEqual(['venues_named'])
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ action: 'held', payload: { venue_id: null } })
    expect(inserted[0].reasons).toContain('Venue must be resolved before publishing')
    expect((inserted[0].reasons as string[]).some(reason => reason.startsWith('Possible venue'))).toBe(false)
    expect(preview).toMatchObject({ action: 'held', venue_name: 'Sala Sintética' })
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
    const { client } = fakeDb([error('database unavailable')])
    await expect(Effect.runPromise(allRowsEffect(client, 'events', '*'))).rejects.toThrow('database unavailable')
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
  it('starts a fresh paid run only within the Apify monthly usage limit', async () => {
    const reservation = { fresh: true, id: 'run', reserved_usd: 1.5, actor_build: '0.0.679', input: { username: ['a'] }, apify_run_id: null }
    const calls: string[] = []
    const limited: ApifyRequest = async (method, path) => {
      calls.push(`${method} ${path}`)
      if (path === 'users/me/limits') return { data: { limits: { maxMonthlyUsageUsd: 19 }, current: { monthlyUsageUsd: 17.6 } } }
      throw new Error(`Unexpected ${method} ${path}`)
    }
    const refused = fakeDb([ok({ collection_enabled: true }), ok(reservation)])
    await expect(Effect.runPromise(collectInstagramEffect(refused.db, limited))).rejects.toThrow('usage limit reached')
    expect(calls).toEqual(['GET users/me/limits'])

    const raised: ApifyRequest = async (method, path) => {
      calls.push(`${method} ${path}`)
      if (path === 'users/me/limits') return { data: { limits: { maxMonthlyUsageUsd: 24 }, current: { monthlyUsageUsd: 17.6 } } }
      if (method === 'POST') return { data: { id: 'new-run', status: 'RUNNING', defaultDatasetId: 'dataset' } }
      return { data: { id: 'new-run', status: 'RUNNING', defaultDatasetId: 'dataset' } }
    }
    const allowed = fakeDb([ok({ collection_enabled: true }), ok(reservation), ok({ id: 'run' })])
    expect(await Effect.runPromise(collectInstagramEffect(allowed.db, raised))).toEqual({ state: 'running', run_id: 'new-run' })
    expect(calls).toContain('POST actors/apify~instagram-post-scraper/runs')
  })
  it('refuses a paid run when the Apify usage limit cannot be read', async () => {
    const reservation = { fresh: true, id: 'run', reserved_usd: 1.5, actor_build: '0.0.679', input: { username: ['a'] }, apify_run_id: null }
    const { db } = fakeDb([ok({ collection_enabled: true }), ok(reservation)])
    const api: ApifyRequest = async (method, path) => {
      if (method === 'GET' && path === 'users/me/limits') return { data: { limits: { maxMonthlyUsageUsd: null }, current: { monthlyUsageUsd: 3 } } }
      throw new Error(`Unexpected ${method} ${path}`)
    }
    await expect(Effect.runPromise(collectInstagramEffect(db, api))).rejects.toThrow('Could not verify the Apify monthly usage limit')
  })
  it('returns the collection summary when the image retry fails after the run is marked succeeded', async () => {
    const { db, calls } = fakeDb([ok({ collection_enabled: true }), ok({ fresh: false, id: 'run', apify_run_id: 'done-run', input: { username: ['a'], resultsLimit: 20 } }),
      ok({ id: 'run' }), error('database unavailable')])
    const api: ApifyRequest = async (_method, path) => path.startsWith('datasets/') ? []
      : { data: { id: 'done-run', status: 'SUCCEEDED', defaultDatasetId: 'dataset', usageTotalUsd: 0.5 } }
    const result = await Effect.runPromise(collectInstagramEffect(db, api))
    expect(calls.indexOf('table:intake_runs')).toBeLessThan(calls.indexOf('table:intake_observations'))
    expect(result).toMatchObject({ state: 'succeeded', run_id: 'done-run', posts: 0,
      media: { retry: { attempted: 0, error: expect.stringContaining('database unavailable') }, retried_failed: [], expired: [], deferred: [] },
      failures: expect.arrayContaining([expect.stringContaining('Media retry stopped early: database unavailable')]) })
  })
  it('returns the collection summary and names the storage failure when the retry cannot save an image', async () => {
    const later = Math.floor(Date.now() / 1000 + 3 * 86400).toString(16)
    const url = (name: string) => `https://scontent.cdninstagram.com/v/${name}.jpg?oe=${later}`
    const { db: base } = fakeDb([ok({ collection_enabled: true }), ok({ fresh: false, id: 'run', apify_run_id: 'done-run', input: { username: ['a'], resultsLimit: 20 } }),
      ok({ id: 'run' })])
    const stored: number[] = []; const fetched: string[] = []
    const store = { ...base,
      unreviewedMedia: () => Effect.succeed([{ id: 'old', media_urls: [url('a'), url('b')], positions: [] }]),
      retainImage: (_id: string, position: number) => { stored.push(position)
        return Effect.fail(new ImportOperationError({ operation: 'intake.store-image', message: 'R2 unavailable' })) } }
    const api: ApifyRequest = async (_method, path) => path.startsWith('datasets/') ? []
      : { data: { id: 'done-run', status: 'SUCCEEDED', defaultDatasetId: 'dataset', usageTotalUsd: 0.5 } }
    const result = await Effect.runPromise(collectInstagramEffect(store, api, async image => {
      fetched.push(image); return { bytes: new Uint8Array([1]), content_type: 'image/jpeg', sha256: 'a'.repeat(64), object_key: `${'a'.repeat(64)}.jpg` } }))
    expect(fetched).toEqual([url('a')])
    expect(stored).toEqual([0])
    expect(result).toMatchObject({ state: 'succeeded', run_id: 'done-run',
      media: { retry: { attempted: 1, retained: 0, error: expect.stringContaining('R2 unavailable (in intake.store-image)') }, retried_failed: [] },
      failures: expect.arrayContaining([expect.stringContaining('intake.store-image')]) })
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
