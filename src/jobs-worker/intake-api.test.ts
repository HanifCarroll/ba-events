/**
 * The intake API on real Miniflare D1: the bearer token, strict inputs, the 404 without D1 that keeps production
 * unchanged, and `collect` running through the CLI's HTTP client (Apify stubbed) against the handler.
 */
import type { D1Database } from '@cloudflare/workers-types'
import { Effect } from 'effect'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { freshD1 } from '../../tests/support/d1.ts'
import { fakeR2 } from '../../tests/support/r2.ts'
import { fakeVectorize } from '../../tests/support/vectorize.ts'
import { collectInstagramEffect, describeImage, retainPostsEffect, retryMissingMediaEffect, type ApifyRequest } from '#features/import/intake/collection.ts'
import { intakeApi, remoteCollection } from '#features/import/intake/client.ts'
import { bearerMatches, handleIntakeRequest, type IntakeApiEnv } from './intake-api.ts'

const TOKEN = 'synthetic-intake-token-0123456789abcdef'
let db: D1Database
let dispose: () => Promise<void>
let env: IntakeApiEnv & { INTAKE_EVIDENCE: ReturnType<typeof fakeR2> }
beforeAll(async () => { ({ db, dispose } = await freshD1()) }, 60_000)
afterAll(async () => { await dispose?.() })
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
    expect(await error(await call('nope'))).toMatchObject({ status: 404 })
    expect((await call('media/x.jpg', { method: 'GET', body: undefined })).status).toBe(400)
    expect((await call(`collection/media?observation_id=${crypto.randomUUID()}&position=0`, { method: 'PUT', body: 'GIF89a' })).status).toBe(400)
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

describe('collect through the CLI client', () => {
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
    expect(result).toMatchObject({ state: 'succeeded', run_id: 'synthetic-run', posts: 1, changed: 1, failures: [], charged_usd: 0.4,
      month: { charged_usd: 0.4, unmeasured_runs: 0, cap_usd: 18 }, apify_cycle: { usage_usd: 1.4, limit_usd: 19 } })
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
    const runId = (await Effect.runPromise(store.reserveCollection())).id
    const flyer = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 7, 7, 7])
    const offline = async () => { throw new Error('offline') }
    const first = await Effect.runPromise(retainPostsEffect(store, runId, [{ id: 'p2', shortCode: 'sc2', ownerUsername: 'synthetic_venue',
      displayUrl: 'https://scontent.cdninstagram.com/v/later.jpg' }], ['synthetic_venue'], 20, offline))
    expect(first.mediaFailed).toHaveLength(1)
    const retry = await Effect.runPromise(retryMissingMediaEffect(store, { fetcher: async () => describeImage(flyer) }))
    expect(retry).toEqual({ attempted: 1, retained: 1, failed: [], expired: [], deferred: [] })
    const saved = await db.prepare('SELECT object_key FROM intake_media').first<{ object_key: string }>()
    expect(env.INTAKE_EVIDENCE.objects.has(saved!.object_key)).toBe(true)
    expect(await Effect.runPromise(store.unreviewedMedia())).toEqual([])
  })
})
