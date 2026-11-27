/**
 * The intake API on real Miniflare D1: the bearer token, strict inputs, the 404 without D1 that keeps production
 * unchanged, and `collect` running through the CLI's HTTP client (Apify stubbed) against the handler.
 */
import type { D1Database } from '@cloudflare/workers-types'
import { Effect } from 'effect'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { freshD1 } from '../../tests/support/d1.ts'
import { fakeR2 } from '../../tests/support/r2.ts'
import { fakeVectorize } from '../../tests/support/vectorize.ts'
import { collectInstagramEffect, describeImage, fetchInstagramImage, retainPostsEffect, retryMissingMediaEffect, type ApifyRequest } from '#features/import/intake/collection.ts'
import { intakeApi, remoteCollection } from '#features/import/intake/client.ts'
import { bearerMatches, handleIntakeRequest, type IntakeApiEnv } from './intake-api.ts'

const TOKEN = 'synthetic-intake-token-0123456789abcdef'
let db: D1Database
let dispose: () => Promise<void>
let env: IntakeApiEnv & { INTAKE_EVIDENCE: ReturnType<typeof fakeR2> }
beforeAll(async () => { ({ db, dispose } = await freshD1()) }, 60_000)
afterAll(async () => { await dispose?.() })
afterEach(() => { vi.unstubAllGlobals() })
beforeEach(async () => {
  await db.batch(['intake_media', 'intake_observations', 'intake_runs', 'instagram_sources'].map(table => db.prepare(`DELETE FROM ${table}`)))
  await db.prepare('UPDATE intake_policy SET collection_enabled = 1, publishing_enabled = 0').run()
  env = { DB: db, VECTORIZE: fakeVectorize().index, INTAKE_EVIDENCE: fakeR2(), INTAKE_ARTWORK: fakeR2(), INTAKE_API_TOKEN: TOKEN }
})

const call = (path: string, init: RequestInit = {}, target: IntakeApiEnv = env) =>
  handleIntakeRequest(new Request(`https://jobs.example/intake/${path}`, { method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: '{}', ...init }), target)
const body = (value: unknown) => ({ body: JSON.stringify(value) })
/** The CLI's client, with fetch going straight to the handler. */
const client = () => intakeApi('https://jobs.example', TOKEN, ((input: RequestInfo | URL, init?: RequestInit) =>
  handleIntakeRequest(new Request(input, init), env)) as typeof fetch)

describe('intake API boundary', () => {
  it('stays a 404 everywhere without a D1 binding, as production is until the cutover', async () => {
    const { DB: _db, ...production } = env
    expect((await call('preflight', {}, production)).status).toBe(404)
    expect((await handleIntakeRequest(new Request('https://jobs.example/'), env)).status).toBe(404)
  })

  it('serves only read operations while DB_READ_ONLY is set (the cutover freeze)', async () => {
    const frozen = { ...env, DB_READ_ONLY: '1' }
    expect((await call('preflight', {}, frozen)).status).toBe(200)
    expect((await call('pending', {}, frozen)).status).toBe(200)
    const refused = await call('source', body({ username: 'synthetic', authority: 'venue', enabled: false, qualification: 'x' }), frozen)
    expect(refused.status).toBe(503)
    expect(await db.prepare('SELECT count(*) AS n FROM instagram_sources').first('n')).toBe(0)
    expect((await call('collection/reserve', {}, frozen)).status).toBe(503)
    expect((await call('collection/release', {}, frozen)).status).toBe(503)
    expect((await call('preflight', {}, { ...frozen, INTAKE_API_TOKEN: 'wrong-token-0123456789abcdef0123456789' })).status).toBe(401)
  })

  it('requires the bearer token and refuses a short configured token', async () => {
    expect((await call('preflight', { headers: { 'content-type': 'application/json' } })).status).toBe(401)
    expect((await call('preflight', { headers: { authorization: `Bearer ${TOKEN}x`, 'content-type': 'application/json' } })).status).toBe(401)
    expect((await call('preflight', {}, { ...env, INTAKE_API_TOKEN: undefined })).status).toBe(401)
    expect(bearerMatches('Bearer short', 'short')).toBe(false)
    expect((await call('preflight')).status).toBe(200)
  })

  it('decodes every input strictly', async () => {
    const error = async (response: Response) => ({ status: response.status, ...(await response.json()) as object })
    expect(await error(await call('preflight', body({ extra: 1 })))).toMatchObject({ status: 400 })
    expect(await error(await call('preview', body({ id: 'not-a-uuid' })))).toMatchObject({ status: 400 })
    expect(await error(await call('source', body({ username: 'Bad Name', authority: 'venue', enabled: false, qualification: 'x' })))).toMatchObject({ status: 400 })
    expect(await error(await call('submit', body({ id: 'x' })))).toMatchObject({ status: 400, error: expect.stringMatching(/^Invalid candidate: id:/) })
    expect(await error(await call('lookup', body({ name: '50%' })))).toMatchObject({ status: 400, error: 'Use a plain name fragment' })
    expect(await error(await call('review', body({ observation_id: crypto.randomUUID(), note: '' })))).toMatchObject({ status: 400 })
    expect(await error(await call('preflight', { body: 'not json' }))).toMatchObject({ status: 400 })
    expect(await error(await call('preflight', { headers: { authorization: `Bearer ${TOKEN}` }, body: '{}' }))).toMatchObject({ status: 400 })
    expect(await error(await call('collection/run', body({ id: crypto.randomUUID(), patch: { state: 'succeeded', charged_usd: -1, completed_at: 'x' } })))).toMatchObject({ status: 400 })
    expect(await error(await call('collection/release', body({ id: crypto.randomUUID(), created_at: 'invalid' })))).toMatchObject({ status: 400 })
    expect(await error(await call('collection/release', body({ id: crypto.randomUUID(), created_at: new Date().toISOString(), extra: true })))).toMatchObject({ status: 400 })
    expect(await error(await call('nope'))).toMatchObject({ status: 404 })
    expect((await call('media/x.jpg', { method: 'GET', body: undefined })).status).toBe(400)
    expect((await call(`collection/media?observation_id=${crypto.randomUUID()}&position=0`, { method: 'PUT', body: 'GIF89a' })).status).toBe(400)
  })

  it.each([
    ['-1', 'Expected a value greater than or equal to 0'],
    ['101', 'Expected a value less than or equal to 100'],
    ['-1e309', 'Expected a value greater than or equal to 0'],
    ['1e309', 'Expected a value less than or equal to 100'],
    ['"invalid"', 'Expected number | null'],
  ])('keeps the collection charge error and field path for %s', async (value, message) => {
    const response = await call('collection/run', {
      body: `{"id":"${crypto.randomUUID()}","patch":{"state":"failed","charged_usd":${value}}}`,
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: `${message}\n  at ["patch"]["charged_usd"]` })
  })

  it('reports operator refusals as 409 with their message', async () => {
    await db.prepare('UPDATE intake_policy SET collection_enabled = 0').run()
    expect(await (await call('collection/reserve')).json()).toEqual({ error: 'Instagram collection is not enabled' })
    expect((await call('collection/reserve')).status).toBe(409)
  })

  it('imports sources insert-only and refuses duplicate usernames in one file', async () => {
    const sources = [{ username: 'synthetic_venue', authority: 'venue', qualification: ' Synthetic ' }]
    expect(await (await call('sources', body({ sources }))).json()).toMatchObject({ inserted: 1, inserted_usernames: ['synthetic_venue'] })
    expect(await (await call('sources', body({ sources }))).json()).toMatchObject({ inserted: 0, already_present: 1 })
    expect((await call('sources', body({ sources: [...sources, ...sources] }))).status).toBe(400)
    expect(await db.prepare('SELECT enabled, qualification FROM instagram_sources').first()).toEqual({ enabled: 0, qualification: 'Synthetic' })
  })
})

describe('Worker image fallback', () => {
  const flyer = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 5, 5, 5])
  const mediaPath = 'collection/fetch-media'
  const storedUrl = 'https://instagram.synthetic.fna.fbcdn.net/flyer.jpg?oe=ffffffff'
  const enableSource = () => db.prepare("INSERT INTO instagram_sources (username, authority, enabled, qualification) VALUES ('synthetic_venue', 'venue', 1, 'Synthetic')").run()
  const observe = async (urls: string[]) => {
    await enableSource()
    const store = remoteCollection(client())
    const run = await Effect.runPromise(store.reserveCollection)
    return (await Effect.runPromise(store.upsertObservation({ run_id: run.id, post_id: 'p1', source_username: 'synthetic_venue',
      post_url: 'https://www.instagram.com/p/sc1/', caption: '', published_at: null, content_hash: '0'.repeat(64), media_urls: urls }))).id
  }

  it('takes only an observation and position and retains the image from the selected stored URL', async () => {
    const id = await observe(['https://scontent.cdninstagram.com/first.jpg', storedUrl])
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => new Response(flyer))
    vi.stubGlobal('fetch', fetcher)
    const position = { observation_id: id, position: 1 }
    expect((await call(mediaPath, body({ ...position, url: 'https://scontent.cdninstagram.com/not-stored.jpg' }))).status).toBe(400)
    expect((await call(mediaPath, body({ observation_id: id, position: '1' }))).status).toBe(400)
    expect((await call(mediaPath, body({ observation_id: id, position: 30 }))).status).toBe(400)
    expect((await call(mediaPath, body({ observation_id: id, position: 2 }))).status).toBe(409)
    expect((await call(mediaPath, body({ ...position, observation_id: crypto.randomUUID() }))).status).toBe(409)
    expect((await call(mediaPath, body(position), { ...env, DB_READ_ONLY: '1' })).status).toBe(503)
    expect(fetcher).not.toHaveBeenCalled()
    const response = await call(mediaPath, body(position))
    expect(response.status).toBe(200)
    const { object_key, sha256 } = await describeImage(flyer)
    expect(await response.json()).toEqual({ object_key })
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(storedUrl, expect.objectContaining({ redirect: 'manual' }))
    expect(await db.prepare('SELECT observation_id, position, content_type, sha256 FROM intake_media').first()).toEqual({
      ...position, content_type: 'image/jpeg', sha256,
    })
    expect(await client().getMedia(object_key)).toEqual(flyer)
  })

  it('never fetches an expired URL or an unsupported HTTPS host, scheme, or origin', async () => {
    const urls = ['https://127.0.0.1/flyer.jpg', 'https://sub.fbcdn.net.example.org/a', 'https://evenfbcdn.net/a',
      'https://fbcdn.net/a', 'https://sub.cdninstagram.com@private.example.org/a', 'https://user:password@sub.cdninstagram.com/a',
      'https://sub.cdninstagram.com:8443/a', 'http://sub.fbcdn.net/a', 'https://scontent.cdninstagram.com/a?oe=01']
    const id = await observe(urls)
    const fetcher = vi.fn(async () => new Response(flyer))
    vi.stubGlobal('fetch', fetcher)
    for (let position = 0; position < urls.length; position++) {
      expect((await call(mediaPath, body({ observation_id: id, position }))).status, urls[position]).toBe(422)
    }
    expect(fetcher).not.toHaveBeenCalled()
    expect(env.INTAKE_EVIDENCE.objects.size).toBe(0)
  })

  it('refuses redirects, non-images, and oversized streams without retaining anything', async () => {
    const id = await observe([storedUrl])
    const fetcher = vi.fn(async () => new Response(flyer))
    vi.stubGlobal('fetch', fetcher)
    for (const upstream of [new Response(null, { status: 302, headers: { location: 'https://different.fbcdn.net/a' } }),
      new Response('<svg></svg>', { headers: { 'content-type': 'image/jpeg' } }),
      new Response(new Uint8Array(10_485_761))]) {
      fetcher.mockResolvedValueOnce(upstream)
      expect((await call(mediaPath, body({ observation_id: id, position: 0 }))).status).toBe(422)
    }
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(env.INTAKE_EVIDENCE.objects.size).toBe(0)
    expect(await db.prepare('SELECT count(*) AS n FROM intake_media').first('n')).toBe(0)
  })

  it('reports a CDN refusal from the fallback and retries the next position', async () => {
    const id = await observe([storedUrl, 'https://scontent.cdninstagram.com/next.jpg'])
    const workerFetch = vi.fn(async () => new Response(flyer)).mockResolvedValueOnce(new Response(null, { status: 403 }))
    vi.stubGlobal('fetch', workerFetch)
    const directFetch: typeof fetch = async () => { throw Object.assign(new Error('unable to connect'), { code: 'ConnectionRefused' }) }
    const retry = await Effect.runPromise(retryMissingMediaEffect(remoteCollection(client()), {
      fetcher: url => fetchInstagramImage(url, directFetch),
    }))
    expect(retry).toMatchObject({ attempted: 2, retained: 1, failed: [
      { observation_id: id, position: 0, reason: 'unable to connect (ConnectionRefused); Worker fallback: answered 403' },
    ], serverFetched: [{ observation_id: id, position: 1 }] })
    expect(retry.error).toBeUndefined()
  })

  it('reports Worker saves from first attempts and retries and does not upload those bytes from the CLI', async () => {
    const olderId = await observe([storedUrl])
    const store = remoteCollection(client())
    const run = await Effect.runPromise(store.reserveCollection)
    await Effect.runPromise(store.updateRun(run.id, { state: 'started', apify_run_id: 'synthetic-run', dataset_id: 'synthetic-dataset' }))
    const newerUrl = 'https://scontent.cdninstagram.com/another.jpg'
    const apify: ApifyRequest = async (_method, path) => {
      if (path === 'actor-runs/synthetic-run') return { data: { id: 'synthetic-run', status: 'SUCCEEDED', defaultDatasetId: 'synthetic-dataset' } }
      if (path === 'datasets/synthetic-dataset/items') return [{ id: 'p2', shortCode: 'sc2', ownerUsername: 'synthetic_venue', displayUrl: newerUrl }]
      throw new Error(`Unexpected ${path}`)
    }
    const workerFetch = vi.fn(async (_url: string) => new Response(flyer))
    vi.stubGlobal('fetch', workerFetch)
    const directFetch = vi.fn<typeof fetch>(async () => { throw Object.assign(new Error('unable to connect'), { code: 'FailedToOpenSocket' }) })
    const upload = vi.spyOn(store, 'retainImage')
    const result = await Effect.runPromise(collectInstagramEffect(store, apify, url => fetchInstagramImage(url, directFetch)))
    const newer = await Effect.runPromise(store.latestObservation('p2'))
    expect(result).toMatchObject({ state: 'succeeded', media: { first_attempt_failed: [], retried_failed: [],
      retry: { attempted: 1, retained: 1 }, server_fetched: [{ observation_id: newer?.id, position: 0 }, { observation_id: olderId, position: 0 }] } })
    expect(workerFetch.mock.calls.map(([url]) => url)).toEqual([newerUrl, storedUrl])
    expect(directFetch).toHaveBeenCalledTimes(2)
    expect(upload).not.toHaveBeenCalled()
  })
})

describe('collect through the CLI client', () => {
  it('persists a zero-charge credit refusal through the API before returning the same error', async () => {
    await db.prepare("INSERT INTO instagram_sources (username, authority, enabled, qualification) VALUES ('synthetic_venue', 'venue', 1, 'Synthetic')").run()
    const store = remoteCollection(client())
    const apify: ApifyRequest = async (method, path) => {
      if (method === 'GET' && path === 'users/me/limits') return { data: { limits: { maxMonthlyUsageUsd: 19 }, current: { monthlyUsageUsd: 19 } } }
      throw new Error(`Unexpected ${method} ${path}`)
    }
    await expect(Effect.runPromise(collectInstagramEffect(store, apify))).rejects.toThrow('Apify monthly usage limit reached; no run started')
    const released = await db.prepare('SELECT id, state, charged_usd, completed_at FROM intake_runs').first()
    expect(released).toMatchObject({ state: 'failed', charged_usd: 0, completed_at: expect.any(String) })
    expect(await Effect.runPromise(store.reserveCollection)).toMatchObject({ id: released?.id, state: 'reserved', fresh: true })
  })

  it('reserves, retains posts and evidence images in R2, and resumes without a second paid run', async () => {
    await db.prepare("INSERT INTO instagram_sources (username, authority, enabled, qualification) VALUES ('synthetic_venue', 'venue', 1, 'Synthetic')").run()
    const flyer = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9])
    let limitsReads = 0
    const apify: ApifyRequest = async (method, path) => {
      if (path === 'users/me/limits') {
        if (++limitsReads === 3) throw new Error('Synthetic limits outage on the resumed run')
        return { data: { limits: { maxMonthlyUsageUsd: 19 }, current: { monthlyUsageUsd: limitsReads === 1 ? 1 : 1.4 } } }
      }
      if (method === 'POST') return { data: { id: 'synthetic-run', status: 'READY', defaultDatasetId: 'synthetic-dataset' } }
      if (path === 'actor-runs/synthetic-run') return { data: { id: 'synthetic-run', status: 'SUCCEEDED', defaultDatasetId: 'synthetic-dataset', usageTotalUsd: 0.4 } }
      if (path === 'datasets/synthetic-dataset/items') return [{ id: 'p1', shortCode: 'sc1', ownerUsername: 'synthetic_venue', caption: 'Synthetic Jazz',
        timestamp: '2026-11-12T12:00:00.000Z', displayUrl: 'https://scontent.cdninstagram.com/v/flyer.jpg' }]
      throw new Error(`Unexpected ${method} ${path}`)
    }
    const store = remoteCollection(client())
    const fetcher = async () => describeImage(flyer)
    const result = await Effect.runPromise(collectInstagramEffect(store, apify, fetcher))
    expect(result).toMatchObject({ state: 'succeeded', run_id: 'synthetic-run', posts: 1, changed: 1, failures: [], charged_usd: 0.4, run_cap_usd: 1.5,
      month: { charged_usd: 0.4, reserved_or_charged_usd: 0.4, unmeasured_runs: 0, cap_usd: 18 }, apify_cycle: { usage_usd: 1.4, limit_usd: 19 } })
    const media = await db.prepare('SELECT object_key, content_type FROM intake_media').all<{ object_key: string }>()
    expect(media.results).toHaveLength(1)
    expect(env.INTAKE_EVIDENCE.objects.has(media.results[0].object_key)).toBe(true)
    expect(await db.prepare('SELECT state, apify_run_id, charged_usd FROM intake_runs').first()).toEqual({ state: 'succeeded', apify_run_id: 'synthetic-run', charged_usd: 0.4 })
    const again = await Effect.runPromise(collectInstagramEffect(store, apify, fetcher))
    expect(again).toMatchObject({ state: 'succeeded', changed: 0, unchanged: 1, charged_usd: 0.4,
      month: { charged_usd: 0.4, unmeasured_runs: 0 }, apify_cycle: null })
    expect(limitsReads).toBe(3) // Before and after the paid run; after only when resumed.
    expect(await (client().getMedia(media.results[0].object_key))).toEqual(flyer)
  })

  it('retries a missing image through the API into R2', async () => {
    await db.prepare("INSERT INTO instagram_sources (username, authority, enabled, qualification) VALUES ('synthetic_venue', 'venue', 1, 'Synthetic')").run()
    const store = remoteCollection(client())
    const runId = (await Effect.runPromise(store.reserveCollection)).id
    const flyer = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 7, 7, 7])
    const offline = async () => { throw new Error('offline') }
    const first = await Effect.runPromise(retainPostsEffect(store, runId, [{ id: 'p2', shortCode: 'sc2', ownerUsername: 'synthetic_venue',
      displayUrl: 'https://scontent.cdninstagram.com/v/later.jpg' }], ['synthetic_venue'], 20, offline))
    expect(first.mediaFailed).toHaveLength(1)
    const retry = await Effect.runPromise(retryMissingMediaEffect(store, { fetcher: async () => describeImage(flyer) }))
    expect(retry).toEqual({ attempted: 1, retained: 1, failed: [], expired: [], deferred: [], serverFetched: [] })
    const saved = await db.prepare('SELECT object_key FROM intake_media').first<{ object_key: string }>()
    expect(env.INTAKE_EVIDENCE.objects.has(saved!.object_key)).toBe(true)
    expect(await Effect.runPromise(store.unreviewedMedia)).toEqual([])
  })
})
