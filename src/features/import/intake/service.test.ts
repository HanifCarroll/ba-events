import type { D1Database } from '@cloudflare/workers-types'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Effect } from 'effect'
import { freshD1 } from '../../../../tests/support/d1.ts'
import { fakeR2 } from '../../../../tests/support/r2.ts'
import { fakeVectorize } from '../../../../tests/support/vectorize.ts'
import { d1Intake } from './store-d1.ts'
import { collectInstagramEffect, type ApifyRequest } from './collection.ts'
import { commitPlanEffect, readEvidenceEffect, previewCandidateEffect, submitCandidateEffect } from './service.ts'
import { readOfficialPage } from './official-page.ts'
import { clockPairs } from './clock-pairs.fixture.ts'
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
      created_at: '2026-11-26T12:00:00.000Z', input: { username: ['a'], resultsLimit: 20 }, ...reservation }),
    updateRun: () => Effect.void, ...overrides,
  } as unknown as CollectionStore
}

describe('Instagram collection budget on D1', () => {
  let db: D1Database
  let dispose: () => Promise<void>
  let store: CollectionStore
  beforeAll(async () => {
    ({ db, dispose } = await freshD1())
    await db.batch([
      db.prepare('UPDATE intake_policy SET collection_enabled = 1, run_cap_usd = 1.5, monthly_cap_usd = 1.5'),
      db.prepare("INSERT INTO instagram_sources (username, authority, enabled, qualification) VALUES ('synthetic_venue', 'venue', 1, 'Synthetic')"),
    ])
    store = d1Intake({ db, evidence: fakeR2(), artwork: fakeR2(), vectors: fakeVectorize().index })
  }, 60_000)
  beforeEach(async () => { await db.prepare('DELETE FROM intake_runs').run() })
  afterAll(async () => { await dispose?.() })

  const usedBudget = () => db.prepare('SELECT COALESCE(SUM(COALESCE(charged_usd, reserved_usd)), 0) AS used FROM intake_runs').first('used')
  const limits = (maxMonthlyUsageUsd: number) => ({ data: { limits: { maxMonthlyUsageUsd }, current: { monthlyUsageUsd: 17.6 } } })

  it('leaves the monthly budget unchanged when Apify refuses credit', async () => {
    const calls: string[] = []
    const api: ApifyRequest = async (method, path) => { calls.push(`${method} ${path}`); return limits(19) }
    const before = await usedBudget()
    await expect(Effect.runPromise(collectInstagramEffect(store, api))).rejects.toThrow('Apify monthly usage limit reached; no run started')
    expect(calls).toEqual(['GET users/me/limits'])
    expect(await usedBudget()).toBe(before)
    expect(await db.prepare('SELECT * FROM intake_runs').first()).toMatchObject({
      state: 'failed', charged_usd: 0, apify_run_id: null, completed_at: expect.any(String),
    })
  })

  it.each([
    ['unavailable', async () => { throw new Error('Limits read unavailable') }, 'Limits read unavailable'],
    ['null limit', async () => ({ data: { limits: { maxMonthlyUsageUsd: null }, current: { monthlyUsageUsd: 3 } } }), 'Could not verify the Apify monthly usage limit'],
    ['non-finite limit', async () => limits(Infinity), 'Could not verify the Apify monthly usage limit'],
  ] as const)('releases the reservation when the Apify limits read gives %s', async (_name, read, message) => {
    const calls: string[] = []
    const api: ApifyRequest = async (method, path) => { calls.push(`${method} ${path}`); return read() }
    await expect(Effect.runPromise(collectInstagramEffect(store, api))).rejects.toThrow(message)
    expect(calls).toEqual(['GET users/me/limits'])
    expect(await usedBudget()).toBe(0)
    expect(await db.prepare('SELECT state, completed_at FROM intake_runs').first()).toEqual({
      state: 'failed', completed_at: expect.any(String),
    })
  })

  it('reuses a released day to check raised credit and starts only one paid run', async () => {
    let limit = 19
    const calls: string[] = []
    const api: ApifyRequest = async (method, path) => {
      calls.push(`${method} ${path}`)
      return path === 'users/me/limits' ? limits(limit)
        : { data: { id: 'new-run', status: 'RUNNING', defaultDatasetId: 'dataset' } }
    }
    const collect = () => Effect.runPromise(collectInstagramEffect(store, api))
    await expect(collect()).rejects.toThrow('Apify monthly usage limit reached; no run started')
    const id = await db.prepare('SELECT id FROM intake_runs').first('id')
    expect(id).toEqual(expect.any(String))
    limit = 24
    expect(await collect()).toEqual({ state: 'running', run_id: 'new-run' })
    expect(await collect()).toEqual({ state: 'running', run_id: 'new-run' })
    expect(calls).toEqual(['GET users/me/limits', 'GET users/me/limits', 'POST actors/apify~instagram-post-scraper/runs',
      'GET actor-runs/new-run', 'GET actor-runs/new-run'])
    expect((await db.prepare('SELECT id, state, apify_run_id, charged_usd, completed_at FROM intake_runs').all()).results).toEqual([
      { id, state: 'started', apify_run_id: 'new-run', charged_usd: null, completed_at: null },
    ])
    expect(await usedBudget()).toBe(1.5)
  })

  it.each([
    ['missing run identity', async () => ({ data: { status: 'RUNNING' } }), 'Unknown Apify start result; reconcile the reserved run before retrying'],
    ['lost response', async () => { throw new Error('Apify start connection lost') }, 'Apify start connection lost'],
  ] as const)('keeps the reservation and blocks a retry after a POST with %s', async (_name, start, message) => {
    const calls: string[] = []
    const api: ApifyRequest = async (method, path) => {
      calls.push(`${method} ${path}`)
      return path === 'users/me/limits' ? limits(24) : start()
    }
    const collect = () => Effect.runPromise(collectInstagramEffect(store, api))
    await expect(collect()).rejects.toThrow(message)
    await expect(collect()).rejects.toThrow('A previous run has an unknown start outcome; do not start another paid run')
    expect(calls).toEqual(['GET users/me/limits', 'POST actors/apify~instagram-post-scraper/runs'])
    expect(await usedBudget()).toBe(1.5)
    expect(await db.prepare('SELECT state, apify_run_id, charged_usd, completed_at FROM intake_runs').first()).toEqual({
      state: 'reserved', apify_run_id: null, charged_usd: null, completed_at: null,
    })
  })
})

describe('page-level doors on D1', () => {
  let db: D1Database
  let dispose: () => Promise<void>
  let store: IntakeStore
  const venue = { id: '20000000-0000-4000-8000-000000000001', name: 'Sala Nube', website: 'https://sala-nube.example.org' }
  const runId = '10000000-0000-4000-8000-000000000001'
  const now = new Date('2026-11-20T12:00:00Z')
  const date = '2026-11-23'
  const dateLine = 'Empieza el lun. 23 de nov 2026 a las 18:00 - 20:00'
  beforeAll(async () => {
    ({ db, dispose } = await freshD1())
    await db.batch([
      db.prepare('UPDATE intake_policy SET publishing_enabled = 1'),
      db.prepare("INSERT INTO instagram_sources (username, authority, enabled, qualification) VALUES ('sala_nube', 'venue', 1, 'Synthetic')"),
      db.prepare(`INSERT INTO intake_runs (id, local_date, state, reserved_usd, charged_usd, input) VALUES (?, '2026-11-20', 'succeeded', 0.01, 0, '{}')`).bind(runId),
      db.prepare("INSERT INTO venues (id, name, website, neighborhood) VALUES (?, ?, ?, 'Palermo')").bind(venue.id, venue.name, venue.website),
    ])
    store = d1Intake({ db, evidence: fakeR2(), artwork: fakeR2(), vectors: fakeVectorize().index })
  }, 60_000)
  afterAll(async () => { await dispose?.() })

  const previewPairs = clockPairs.filter(pair => pair.previewAt)
  it.each(previewPairs.flatMap(pair => (['caption', 'official page'] as const).map(source => ({ ...pair, source }))))(
    'previews paired clock claims from $source: $name', async ({ accepted, rejected, source, previewAt }) => {
      const name = 'Concierto Sintético'
      const dateLine = `${name} en ${venue.name}, el lunes 23 de noviembre.`
      const url = `${venue.website}/reloj`
      async function previewClaim({ quote, time, source: visible = quote }: typeof accepted) {
        const id = crypto.randomUUID()
        const caption = source === 'caption' ? `${dateLine}\n${visible}` : dateLine
        const post = await Effect.runPromise(store.upsertObservation({ run_id: runId, post_id: id, source_username: 'sala_nube',
          post_url: `https://www.instagram.com/p/${id}/`, caption, published_at: null, content_hash: id.replaceAll('-', '').repeat(2), media_urls: [] }))
        const timeEvidence = source === 'caption' ? { observation_id: post.id, fields: ['time'], excerpt: quote, media_id: null }
          : { kind: 'official_page', url, fields: ['time'], excerpt: quote }
        await Effect.runPromise(submitCandidateEffect(store, {
          id, expected_revision: 0, intent: 'create', target_event_id: null, name, date, time,
          venue_name: venue.name, venue_id: venue.id, description_es: null, description_en: null, categories: ['music'], status: 'scheduled',
          price_kind: 'unknown', price_ars: null, price_note: null, ticket_url: null, artwork_media_id: null, artwork_note: 'Synthetic clock fixture',
          issues: [], notes: '', evidence: [{ observation_id: post.id, fields: ['name', 'venue', 'date'], excerpt: dateLine, media_id: null }, timeEvidence],
        }))
        const readPage = (url: string, sites: ReadonlySet<string>) => readOfficialPage(url, sites, async () => new Response(
          `<h1>${name}</h1><p>${visible}</p>`, { headers: { 'content-type': 'text/html' } }))
        return Effect.runPromise(previewCandidateEffect(store, id, now, readPage))
      }

      expect(await previewClaim(accepted)).toMatchObject({ action: 'create', reasons: [], payload: { starts_at: previewAt, time_tba: false } })
      const held = await previewClaim(rejected)
      expect(held.action).toBe('held')
      expect(held.reasons.join('\n')).toMatch(/time|clock/i)
    }, 20_000,
  )

  it.each([
    { name: 'Trío Nube', excerpt: 'Abrimos las puertas a las 21h', time: '21:00', dateSource: 'page', doorsAt: '2026-11-24T00:00:00.000Z' },
    { name: 'Marea de Papel', excerpt: 'Ingreso 17h', time: '17:00', dateSource: 'post', doorsAt: '2026-11-23T20:00:00.000Z' },
    { name: 'Canciones de Sal', excerpt: 'Ingreso a las 20:30. Servimos la cena y luego comienza el espectáculo', time: '20:30', dateSource: 'page', doorsAt: '2026-11-23T23:30:00.000Z' },
    { name: 'Varieté Prisma', excerpt: 'Ingreso a las 21. A las 21:45 aproximadamente comienza el espectáculo.', time: '21:00', dateSource: 'page', doorsAt: '2026-11-24T00:00:00.000Z' },
    { name: 'Cuarteto Tinta', excerpt: 'Apertura de sala 21 hs', time: '21:00', dateSource: 'post', doorsAt: '2026-11-24T00:00:00.000Z' },
    { name: 'Orquesta Humedal', excerpt: 'Puertas: 20:30', time: '20:30', dateSource: 'none', doorsAt: undefined },
  ])('previews page-level doors for $name, date source: $dateSource', async ({ name, excerpt, time, dateSource, doorsAt }) => {
    const url = `${venue.website}/show`
    const caption = `${name} en ${venue.name}${dateSource === 'post' ? ' el lunes 23 de noviembre' : ''}`
    const id = crypto.randomUUID()
    const post = await Effect.runPromise(store.upsertObservation({ run_id: runId, post_id: id, source_username: 'sala_nube',
      post_url: `https://www.instagram.com/p/${id}/`, caption, published_at: null, content_hash: id.replaceAll('-', '').repeat(2), media_urls: [] }))
    const candidate = {
      id, expected_revision: 0, intent: 'create', target_event_id: null, name, date, time: null, doors_time: time,
      venue_name: venue.name, venue_id: venue.id, description_es: null, description_en: null, categories: ['music'], status: 'scheduled',
      price_kind: 'unknown', price_ars: null, price_note: null, ticket_url: null, artwork_media_id: null, artwork_note: 'Fixture without a flyer',
      issues: [], notes: '', evidence: [
        { observation_id: post.id, fields: ['name', 'venue', ...(dateSource === 'post' ? ['date'] : [])], excerpt: caption, media_id: null },
        ...(dateSource === 'page' ? [{ kind: 'official_page', url, fields: ['date'], excerpt: dateLine }] : []),
        { kind: 'official_page', url, fields: ['doors_time'], excerpt },
      ],
    }
    await Effect.runPromise(submitCandidateEffect(store, candidate))
    let entryLine = excerpt
    const readPage = (url: string, sites: ReadonlySet<string>) => readOfficialPage(url, sites, async () => new Response(
      `<h1>${name}</h1>${dateSource === 'page' ? `<p>${dateLine}</p>` : ''}<p>${entryLine}</p>`, { headers: { 'content-type': 'text/html' } }))
    const preview = await Effect.runPromise(previewCandidateEffect(store, id, now, readPage))
    if (!doorsAt) {
      expect(preview).toMatchObject({ action: 'held', reasons: ['Missing evidence for date'], payload: { time_tba: true } })
      expect(preview.payload.doors_at).toBeUndefined()
      return
    }
    expect(preview).toMatchObject({ action: 'create', reasons: [], payload: { starts_at: '2026-11-23T03:00:00.000Z', time_tba: true, doors_at: doorsAt } })
    const publishers = {
      readPage, embed: async () => ({ embedding: Array(1536).fill(0.1), searchDocument: name }),
      presentation: async () => ({ description_display_es: null, description_display_en: null, description_summary_es: null, description_summary_en: null }),
    }
    if (dateSource === 'post') {
      entryLine = 'Ingreso 18h'
      const embed = vi.fn(publishers.embed)
      await expect(Effect.runPromise(commitPlanEffect(store, preview.id, { ...publishers, embed })))
        .rejects.toThrow("must be an excerpt of the page's visible text")
      expect(embed).not.toHaveBeenCalled()
      entryLine = excerpt
    }
    await Effect.runPromise(commitPlanEffect(store, preview.id, publishers))
    expect(await db.prepare('SELECT starts_at, time_tba, doors_at FROM events WHERE id = ?').bind(preview.event_id).first())
      .toEqual({ starts_at: '2026-11-23T03:00:00.000Z', time_tba: 1, doors_at: doorsAt })
  })
})

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

  it('plans separate doors and start timestamps from an official page and rechecks the doors at commit', async () => {
    const venue = { id: '20000000-0000-4000-8000-000000000001', name: 'Sala Sintética', neighborhood: 'Palermo', website: 'https://sala.example.org' }
    const post = { id: '30000000-0000-4000-8000-000000000001', post_id: 'post-1', source_username: 'synthetic',
      caption: 'Synthetic Jazz en Sala Sintética', media_urls: [] }
    const excerpt = 'Lunes 23 de noviembre - Puerta 21 hs - Show 22 hs'
    const candidate = decodeCandidate({ id: '10000000-0000-4000-8000-000000000003', expected_revision: 1, intent: 'create', target_event_id: null,
      name: 'Synthetic Jazz', date: '2026-11-23', time: '22:00', doors_time: '21:00', venue_name: venue.name, venue_id: venue.id,
      description_es: null, description_en: null, categories: ['music'], status: 'scheduled', price_kind: 'unknown',
      price_ars: null, price_note: null, ticket_url: null, artwork_media_id: null, artwork_note: 'No flyer on this post', issues: [], notes: '',
      evidence: [{ observation_id: post.id, fields: ['name', 'venue'], excerpt: post.caption, media_id: null },
        { kind: 'official_page', url: `${venue.website}/obra`, fields: ['date', 'time', 'doors_time'], excerpt }],
    })
    let line = excerpt
    const readPage = (url: string, sites: ReadonlySet<string>) => readOfficialPage(url, sites, async () => new Response(
      `<h1>Synthetic Jazz</h1><p>${line}</p>`, { headers: { 'content-type': 'text/html' } }))
    let saved = plan
    const db = commitStore(plan, {
      candidate: () => Effect.succeed({ revision: 1, payload: candidate, id: candidate.id }),
      venue: () => Effect.succeed(venue),
      observationsByIds: () => Effect.succeed([post]), mediaForObservations: () => Effect.succeed([]),
      sourceAuthorities: () => Effect.succeed([{ username: 'synthetic', authority: 'venue' }]),
      latestObservation: () => Effect.succeed({ id: post.id, content_hash: 'synthetic' }),
      linkedEventIds: () => Effect.succeed([]), eventsBetween: () => Effect.succeed([]),
      insertPlan: row => Effect.sync(() => saved = { ...row, id: 'plan', receipt: null, payload: { ...row.payload, embedding: Array(1536).fill(0.1) } }),
      plan: () => Effect.sync(() => saved),
    })
    const preview = await Effect.runPromise(previewCandidateEffect(db, candidate.id, new Date('2026-10-25'), readPage))
    expect(preview).toMatchObject({ action: 'create', reasons: [], payload: {
      starts_at: '2026-11-24T01:00:00.000Z', doors_at: '2026-11-24T00:00:00.000Z', time_tba: false,
    } })
    const publishers = { readPage, embed: async () => { throw new Error('Unexpected embedding') },
      presentation: async () => { throw new Error('Unexpected presentation') } }
    line = excerpt.replace('Puerta 21', 'Puerta 20')
    await expect(Effect.runPromise(commitPlanEffect(db, preview.id, publishers))).rejects.toThrow("must be an excerpt of the page's visible text")
    line = excerpt
    await expect(Effect.runPromise(commitPlanEffect(db, preview.id, publishers))).resolves.toEqual(receipt)
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
