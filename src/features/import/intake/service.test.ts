import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import { collectInstagramEffect, type ApifyRequest } from './collection.ts'
import { commitPlanEffect, readEvidenceEffect, previewCandidateEffect } from './service.ts'
import { readOfficialPage } from './official-page.ts'
import { decodeCandidate } from './schema.ts'
import { ImportOperationError } from '../core/effect-utils.ts'
import type { CollectionStore, IntakePlanRow, IntakeStore, Reservation } from './store.ts'

const fail = (message: string) => Effect.fail(new ImportOperationError({ operation: 'intake-test', message }))
const plan: IntakePlanRow = { id: 'plan', action: 'create', candidate_id: 'candidate', revision: 1, receipt: null, evidence: [],
  event_id: 'event', expected_event_updated_at: null, reasons: [], artwork_media_id: 'media',
  payload: { name: 'Synthetic Jazz', starts_at: '2026-11-20T00:00:00Z', source: 'instagram-intake', embedding: Array(1536).fill(0.1) } }
const receipt = { event_id: 'event', action: 'create' }
const media = { id: 'media', observation_id: 'obs', position: 0, object_key: 'synthetic.jpg', content_type: 'image/jpeg', sha256: 'a'.repeat(64) }
function commitStore(row = plan, overrides: Partial<IntakeStore> = {}): IntakeStore {
  return {
    plan: () => Effect.succeed(row), publishingEnabled: Effect.succeed(true), checkPlan: () => Effect.void,
    eventVenue: () => Effect.succeed({ name: 'Synthetic Venue', neighborhood: 'Palermo' }),
    preparePlan: () => Effect.void, artworkMedia: () => Effect.succeed(media), publishArtwork: () => Effect.void,
    commitPlan: () => Effect.succeed(receipt), replayReceipt: () => Effect.succeed(receipt), ...overrides,
  } as unknown as IntakeStore
}
function collectionStore(reservation: Partial<Reservation>, overrides: Partial<CollectionStore> = {}): CollectionStore {
  return {
    policy: Effect.succeed({ collection_enabled: true, publishing_enabled: false, max_sources: 10,
      posts_per_source: 20, run_cap_usd: 2, monthly_cap_usd: 10, actor_build: '0.0.679', data_detail_level: 'basic' }),
    reserveCollection: Effect.succeed({ id: 'run', fresh: false, apify_run_id: null, reserved_usd: 1.5,
      input: { username: ['a'], resultsLimit: 20 }, ...reservation }),
    updateRun: () => Effect.void, ...overrides,
  } as unknown as CollectionStore
}

describe('intake failure and retry orchestration', () => {
  it('loads media alongside observations and does not block the dependent source read on media', async () => {
    let releasePosts!: () => void
    let releaseMedia!: () => void
    const posts = new Promise<void>((resolve) => { releasePosts = resolve })
    const media = new Promise<void>((resolve) => { releaseMedia = resolve })
    const calls: string[] = []
    const db = {
      observationsByIds: () => Effect.promise(async () => { calls.push('observations'); await posts; return [{ id: 'observation', source_username: 'synthetic' }] }),
      mediaForObservations: () => Effect.promise(async () => { calls.push('media'); await media; return [{ id: 'media' }] }),
      sourceAuthorities: () => Effect.sync(() => { calls.push('sources'); return [{ username: 'synthetic', authority: 'venue' }] }),
    } as unknown as IntakeStore
    const running = Effect.runPromise(readEvidenceEffect(db, { evidence: [{ observation_id: 'observation' }] } as never))
    try {
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(calls).toEqual(['observations', 'media'])
      releasePosts()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(calls).toContain('sources')
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
    const planned: unknown[] = []
    const db = {
      candidate: () => Effect.succeed({ revision: 0, payload: candidate, id: candidate.id }),
      sourceAuthorities: () => Effect.succeed([{ username: 'synthetic', authority: 'venue' }]),
      mediaForObservations: () => Effect.succeed([]), observationsByIds: () => Effect.succeed(posts),
      latestObservation: () => Effect.promise(async () => { checks++; await gate }).pipe(Effect.andThen(fail('Synthetic freshness outage'))),
      insertPlan: (row: Parameters<IntakeStore['insertPlan']>[0]) => Effect.sync(() => { planned.push(row); return { ...row, id: 'plan', receipt: null } }),
    } as unknown as IntakeStore
    const running = Effect.runPromise(previewCandidateEffect(db, candidate.id, new Date('2026-10-25')))
    const outcome = running.then(() => null, (failure: Error) => failure)
    try {
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(checks).toBe(4)
    } finally { release() }
    expect((await outcome)?.message).toContain('Synthetic freshness outage')
    expect(checks).toBe(4)
    expect(planned).toHaveLength(0)
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
    const lookups: string[] = []
    const db = {
      candidate: () => Effect.succeed({ revision: 0, payload: candidate, id: candidate.id }),
      sourceAuthorities: () => Effect.succeed([{ username: 'synthetic', authority: 'venue' }]),
      mediaForObservations: () => Effect.succeed([]), observationsByIds: () => Effect.succeed([post]),
      latestObservation: () => Effect.succeed({ id: post.id, content_hash: 'synthetic' }),
      venueHint: (name: string) => Effect.sync(() => { lookups.push(name) }).pipe(Effect.andThen(fail('Venue lookup unavailable'))),
      linkedEventIds: () => Effect.succeed([]), eventsBetween: () => Effect.succeed([]),
      insertPlan: (row: Parameters<IntakeStore['insertPlan']>[0]) => Effect.sync(() => { inserted.push(row); return { ...row, id: 'plan', receipt: null } }),
    } as unknown as IntakeStore
    const preview = await Effect.runPromise(previewCandidateEffect(db, candidate.id, new Date('2026-10-25')))
    expect(lookups).toEqual(['Sala Sintética'])
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ action: 'held', payload: { venue_id: null } })
    expect(inserted[0].reasons).toContain('Venue must be resolved before publishing')
    expect((inserted[0].reasons as string[]).some(reason => reason.startsWith('Possible venue'))).toBe(false)
    expect(preview).toMatchObject({ action: 'held', venue_name: 'Sala Sintética' })
  })

  it('uses the selected venue website to verify calendar evidence in preview and rechecks it at commit', async () => {
    const venueId = '20000000-0000-4000-8000-000000000001'
    const url = 'https://sala.example.org/calendario'
    const post = { id: '30000000-0000-4000-8000-000000000001', post_id: 'post-1', source_username: 'synthetic',
      caption: `Synthetic Jazz en Sala Sintética. Funciones: ${url}`, media_urls: [] }
    const candidate = decodeCandidate({ id: '10000000-0000-4000-8000-000000000003', expected_revision: 1, intent: 'create', target_event_id: null,
      name: 'Synthetic Jazz', date: '2026-11-20', time: '21:00', venue_name: 'Sala Sintética', venue_id: venueId,
      description_es: null, description_en: null, categories: ['music'], status: 'scheduled', price_kind: 'unknown',
      price_ars: null, price_note: null, ticket_url: null, artwork_media_id: null, artwork_note: 'No flyer on this post', issues: [], notes: '',
      evidence: [{ observation_id: post.id, fields: ['name', 'venue'], excerpt: 'Synthetic Jazz en Sala Sintética', media_id: null },
        { kind: 'official_page', url, fields: ['date', 'time'], excerpt: '2026-11-20 21:00 | Synthetic Jazz' }],
    })
    const html = `<table><tr><td id="li-2026-11-20"><ul><li><div class="calendar-hora">21:00 hs</div>
      <a href="/obra/sintetica/">Synthetic Jazz</a></li></ul></td></tr></table>`
    const fetcher: typeof fetch = async () => new Response(html, { headers: { 'content-type': 'text/html' } })
    const readPage = (url: string, sites: ReadonlySet<string>) => readOfficialPage(url, sites, fetcher)
    let website: string | null = 'https://www.sala.example.org'
    let saved = plan
    const db = commitStore(plan, {
      candidate: () => Effect.succeed({ revision: 1, payload: candidate, id: candidate.id }),
      venue: id => { expect(id).toBe(venueId); return Effect.succeed({ id, name: 'Sala Sintética', neighborhood: 'Palermo', website }) },
      observationsByIds: () => Effect.succeed([post]), mediaForObservations: () => Effect.succeed([]),
      sourceAuthorities: () => Effect.succeed([{ username: 'synthetic', authority: 'venue' }]),
      latestObservation: () => Effect.succeed({ id: post.id, content_hash: 'synthetic' }),
      linkedEventIds: () => Effect.succeed([]), eventsBetween: () => Effect.succeed([]),
      insertPlan: row => Effect.sync(() => saved = { ...row, id: 'plan', receipt: null }),
      plan: () => Effect.sync(() => saved),
    })
    const preview = await Effect.runPromise(previewCandidateEffect(db, candidate.id, new Date('2026-10-25'), readPage))
    expect(preview).toMatchObject({ action: 'create', reasons: [] })
    // The caption still authorizes a normal page on the old site, but not the calendar exception.
    website = null
    await expect(Effect.runPromise(commitPlanEffect(db, preview.id, {
      readPage, embed: async () => { throw new Error('Unexpected embedding') },
      presentation: async () => { throw new Error('Unexpected presentation') },
    }))).rejects.toThrow("calendar evidence must be on the selected venue's stored website")
  })

  it('overlaps publication preparation but waits for both results before writing', async () => {
    const unprepared = { ...plan, artwork_media_id: null, payload: { ...plan.payload, embedding: undefined, venue_id: 'venue' } }
    const calls: string[] = []
    const db = commitStore(unprepared, {
      preparePlan: () => Effect.sync(() => { calls.push('prepare') }),
      commitPlan: () => Effect.sync(() => { calls.push('commit'); return receipt }),
    })
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
      expect(calls).toEqual([])
    } finally { release() }
    expect(await running).toEqual(receipt)
    expect(calls).toEqual(['prepare', 'commit'])
  })

  it('does no preparation or publication for a disabled workflow', async () => {
    const db = commitStore(plan, { publishingEnabled: Effect.succeed(false), checkPlan: () => fail('unexpected plan check') })
    await expect(Effect.runPromise(commitPlanEffect(db, 'plan'))).rejects.toThrow('disabled')
  })
  it('rejects changed evidence before provider calls or public image uploads', async () => {
    const db = commitStore(plan, { checkPlan: () => fail('Source changed after review'), publishArtwork: () => fail('unexpected artwork upload') })
    await expect(Effect.runPromise(commitPlanEffect(db, 'plan'))).rejects.toThrow('Source changed after review')
  })
  it('retries artwork preparation even when a previous attempt already prepared its embedding', async () => {
    const calls: string[] = []
    const db = commitStore(plan, {
      publishArtwork: () => Effect.sync(() => { calls.push('artwork') }).pipe(Effect.andThen(
        Effect.suspend(() => calls.length === 1 ? fail('temporary storage failure') : Effect.void))),
      commitPlan: () => Effect.sync(() => { calls.push('commit'); return receipt }),
    })
    await expect(Effect.runPromise(commitPlanEffect(db, 'plan'))).rejects.toThrow('temporary storage failure')
    expect(calls).toEqual(['artwork'])
    expect(await Effect.runPromise(commitPlanEffect(db, 'plan'))).toEqual(receipt)
    expect(calls).toEqual(['artwork', 'artwork', 'commit'])
  })
  it('replays a receipt without publishing artwork again', async () => {
    const db = commitStore({ ...plan, receipt }, { publishingEnabled: fail('unexpected policy read'), publishArtwork: () => fail('unexpected artwork upload') })
    expect(await Effect.runPromise(commitPlanEffect(db, 'plan'))).toEqual(receipt)
  })
  it('keeps unknown admission out of free/paid search claims while preparing publication', async () => {
    const db = commitStore({ ...plan, artwork_media_id: null, payload: { ...plan.payload, embedding: undefined,
      price: null, is_free: false, venue_id: 'venue' } })
    const publishers = {
      embed: async (input: { is_free?: boolean }) => {
        expect(input.is_free).toBeUndefined()
        return { embedding: Array(1536).fill(0.1), searchDocument: 'Synthetic Jazz' }
      },
      presentation: async () => ({ description_display_es: null, description_display_en: null, description_summary_es: null, description_summary_en: null }),
    }
    expect(await Effect.runPromise(commitPlanEffect(db, 'plan', publishers))).toEqual(receipt)
  })
  it('never starts a second paid run after an uncertain start', async () => {
    const db = collectionStore({})
    const api: ApifyRequest = async () => { throw new Error('No API call is allowed') }
    await expect(Effect.runPromise(collectInstagramEffect(db, api))).rejects.toThrow('unknown start outcome')
  })
  it('starts a fresh paid run only within the Apify monthly usage limit', async () => {
    const reservation = { fresh: true, id: 'run', reserved_usd: 1.5, actor_build: '0.0.679', input: { username: ['a'], resultsLimit: 20 }, apify_run_id: null }
    const calls: string[] = []
    const limited: ApifyRequest = async (method, path) => {
      calls.push(`${method} ${path}`)
      if (path === 'users/me/limits') return { data: { limits: { maxMonthlyUsageUsd: 19 }, current: { monthlyUsageUsd: 17.6 } } }
      throw new Error(`Unexpected ${method} ${path}`)
    }
    const refused = collectionStore(reservation)
    await expect(Effect.runPromise(collectInstagramEffect(refused, limited))).rejects.toThrow('usage limit reached')
    expect(calls).toEqual(['GET users/me/limits'])

    const raised: ApifyRequest = async (method, path) => {
      calls.push(`${method} ${path}`)
      if (path === 'users/me/limits') return { data: { limits: { maxMonthlyUsageUsd: 24 }, current: { monthlyUsageUsd: 17.6 } } }
      if (method === 'POST') return { data: { id: 'new-run', status: 'RUNNING', defaultDatasetId: 'dataset' } }
      return { data: { id: 'new-run', status: 'RUNNING', defaultDatasetId: 'dataset' } }
    }
    const allowed = collectionStore(reservation)
    expect(await Effect.runPromise(collectInstagramEffect(allowed, raised))).toEqual({ state: 'running', run_id: 'new-run' })
    expect(calls).toContain('POST actors/apify~instagram-post-scraper/runs')
  })
  it.each([null, Infinity])('refuses a paid run when Apify reports %s as the monthly usage limit', async (limit) => {
    const reservation = { fresh: true, id: 'run', reserved_usd: 1.5, actor_build: '0.0.679', input: { username: ['a'], resultsLimit: 20 }, apify_run_id: null }
    const db = collectionStore(reservation)
    const calls: string[] = []
    const api: ApifyRequest = async (method, path) => {
      calls.push(`${method} ${path}`)
      if (method === 'GET' && path === 'users/me/limits') return { data: { limits: { maxMonthlyUsageUsd: limit }, current: { monthlyUsageUsd: 3 } } }
      throw new Error(`Unexpected ${method} ${path}`)
    }
    await expect(Effect.runPromise(collectInstagramEffect(db, api))).rejects.toThrow('Could not verify the Apify monthly usage limit')
    expect(calls).toEqual(['GET users/me/limits'])
  })
  it('requires reconciliation when Apify starts a run but returns no valid run identity', async () => {
    const calls: string[] = []
    const writes: string[] = []
    const db = collectionStore({ fresh: true }, {
      updateRun: (_, patch) => Effect.sync(() => { writes.push(patch.state) }),
    })
    const api: ApifyRequest = async (method, path) => {
      calls.push(`${method} ${path}`)
      if (path === 'users/me/limits') {
        return { data: { limits: { maxMonthlyUsageUsd: 19 }, current: { monthlyUsageUsd: 3 } } }
      }
      return { data: { status: 'RUNNING' } }
    }
    await expect(Effect.runPromise(collectInstagramEffect(db, api))).rejects.toMatchObject({
      _tag: 'ImportOperationError', operation: 'instagram.collection',
      message: 'Unknown Apify start result; reconcile the reserved run before retrying',
    })
    expect(calls).toEqual(['GET users/me/limits', 'POST actors/apify~instagram-post-scraper/runs'])
    expect(writes).toEqual([])
  })
  it('returns the collection summary when the image retry fails after the run is marked succeeded', async () => {
    const calls: string[] = []
    const db = collectionStore({ apify_run_id: 'done-run' }, {
      updateRun: (_, patch) => Effect.sync(() => { calls.push(patch.state) }),
      unreviewedMedia: Effect.sync(() => { calls.push('retry') }).pipe(Effect.andThen(fail('database unavailable'))),
    })
    const api: ApifyRequest = async (_method, path) => path.startsWith('datasets/') ? []
      : { data: { id: 'done-run', status: 'SUCCEEDED', defaultDatasetId: 'dataset', usageTotalUsd: 0.5 } }
    const result = await Effect.runPromise(collectInstagramEffect(db, api))
    expect(calls).toEqual(['succeeded', 'retry'])
    expect(result).toMatchObject({ state: 'succeeded', run_id: 'done-run', posts: 0,
      media: { retry: { attempted: 0, error: expect.stringContaining('database unavailable') }, retried_failed: [], expired: [], deferred: [] },
      failures: expect.arrayContaining([expect.stringContaining('Media retry stopped early: database unavailable')]) })
  })
  it('returns the collection summary and names the storage failure when the retry cannot save an image', async () => {
    const later = Math.floor(Date.now() / 1000 + 3 * 86400).toString(16)
    const url = (name: string) => `https://scontent.cdninstagram.com/v/${name}.jpg?oe=${later}`
    const base = collectionStore({ apify_run_id: 'done-run' })
    const stored: number[] = []; const fetched: string[] = []
    const store = { ...base,
      unreviewedMedia: Effect.succeed([{ id: 'old', media_urls: [url('a'), url('b')], positions: [] }]),
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
    const db = collectionStore({ apify_run_id: 'existing-run' })
    const api: ApifyRequest = async (method, path) => {
      expect(method).toBe('GET'); expect(path).toBe('actor-runs/existing-run')
      return { data: { id: 'existing-run', status: 'RUNNING', defaultDatasetId: 'dataset' } }
    }
    expect(await Effect.runPromise(collectInstagramEffect(db, api))).toEqual({ state: 'running', run_id: 'existing-run' })
  })
})
