import { Cause, Effect, Schema } from 'effect'
import { importTry, ImportOperationError } from '../core/effect-utils.ts'
import type { CollectionStore, UnreviewedMedia } from './store.ts'

export type ApifyRequest = (method: 'GET' | 'POST', path: string, params?: Record<string, unknown>, body?: unknown) => Promise<unknown>
const Child = Schema.Struct({ displayUrl: Schema.optional(Schema.String), images: Schema.optional(Schema.Array(Schema.String)) })
const PostSchema = Schema.Struct({
  id: Schema.optional(Schema.String), shortCode: Schema.optional(Schema.String), url: Schema.optional(Schema.String),
  caption: Schema.optional(Schema.String), timestamp: Schema.optional(Schema.String), ownerUsername: Schema.optional(Schema.String),
  inputUrl: Schema.optional(Schema.String), displayUrl: Schema.optional(Schema.String), images: Schema.optional(Schema.Array(Schema.String)),
  childPosts: Schema.optional(Schema.Array(Child)), error: Schema.optional(Schema.String),
  errorDescription: Schema.optional(Schema.String), username: Schema.optional(Schema.String),
  coauthorProducers: Schema.optional(Schema.Array(Schema.Struct({ username: Schema.String }))),
})
export type Post = typeof PostSchema.Type
const sha256 = async (value: string | Uint8Array<ArrayBuffer>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? new TextEncoder().encode(value) : value))].map(byte => byte.toString(16).padStart(2, '0')).join('')
const fail = (message: string) => new ImportOperationError({ operation: 'instagram.collection', message })
const Run = Schema.Struct({ data: Schema.Struct({ id: Schema.String, status: Schema.String, defaultDatasetId: Schema.String,
  usageTotalUsd: Schema.optional(Schema.Number) }) })
const readRun = (value: unknown) => Schema.decodeUnknownSync(Run)(value).data

export function mediaUrls(post: Post): string[] {
  const children = post.childPosts?.flatMap(child => [...(child.images ?? []), ...(child.displayUrl ? [child.displayUrl] : [])]) ?? []
  return [...new Set([...(post.images ?? []), ...children, ...(children.length || post.images?.length ? [] : post.displayUrl ? [post.displayUrl] : [])])]
}
/** Collab posts arrive under the co-poster's account; attribute them to the first configured coauthor. */
export function postSource(post: Post, usernames: readonly string[]): string | undefined {
  return [post.ownerUsername, ...(post.coauthorProducers ?? []).map(coauthor => coauthor.username)]
    .map(name => name?.toLowerCase()).find(name => name !== undefined && usernames.includes(name))
}
/** Apify writes (and bills) one error row per account that returned no posts; name the account so dead ones can be switched off. */
export function sourceCoverage(posts: readonly Post[], usernames: readonly string[], ceiling: number) {
  const counts = new Map<string, number>(); const counted = new Set<string>()
  const quiet: string[] = []; const dead: Array<{ username: string; reason: string }> = []; const errored: Array<{ username: string; reason: string }> = []
  for (const post of posts) {
    if (post.error) {
      const handle = (post.username ?? [post.inputUrl, post.url].map(url => url?.match(/instagram\.com\/([^/?#]+)/i)?.[1]).find(Boolean) ?? '').toLowerCase()
      const reason = [post.error, post.errorDescription].filter(Boolean).join(': ')
      if (handle) counts.set(handle, counts.get(handle) ?? 0)
      const entry = { username: handle || 'unknown', reason }
      if (post.error === 'no_items') quiet.push(entry.username)
      else if (post.error === 'not_found' || /restricted/i.test(reason)) dead.push(entry)
      else errored.push(entry)
    } else {
      const source = postSource(post, usernames)
      if (!source || (post.id && counted.has(post.id))) continue
      if (post.id) counted.add(post.id)
      counts.set(source, (counts.get(source) ?? 0) + 1)
    }
  }
  return { charged_rows: posts.length, quiet_sources: quiet, dead_sources: dead, errored_sources: errored,
    at_ceiling_sources: usernames.filter(name => (counts.get(name) ?? 0) >= ceiling),
    // No post and no error row: the run stopped (e.g. at its charge cap) before reaching these accounts.
    uncovered_sources: usernames.filter(name => !counts.has(name)) }
}
export function allowedInstagramMedia(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      /^(?:[a-z0-9-]+\.)+(?:cdninstagram\.com|fbcdn\.net)$/.test(url.hostname)
  } catch { return false }
}

/** Direct network adapter: no redirects, credentials, SVG or unbounded downloads. */
export async function fetchInstagramImage(url: string, fetcher: typeof fetch = fetch) {
  if (!allowedInstagramMedia(url)) throw new Error('Unsupported Instagram media origin')
  const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Accept: 'image/jpeg,image/png,image/webp' } })
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > 10485760) throw new Error('Image download failed or exceeds limit')
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break
      length += value.byteLength; if (length > 10485760) throw new Error('Image exceeds limit')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  const bytes = new Uint8Array(length); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return describeImage(bytes)
}

/** Evidence image identity from its bytes alone: JPEG, PNG or WebP by magic number, keyed by its sha256. */
export async function describeImage(bytes: Uint8Array<ArrayBuffer>) {
  if (bytes.byteLength > 10485760) throw new Error('Image exceeds limit')
  const type = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'jpeg' :
    bytes[0] === 137 && String.fromCharCode(...bytes.slice(1, 4)) === 'PNG' ? 'png' :
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP' ? 'webp' : null
  if (!type) throw new Error('Unsupported image bytes')
  const hash = await sha256(bytes)
  return { bytes, content_type: `image/${type}`, sha256: hash, object_key: `${hash}.${type === 'jpeg' ? 'jpg' : type}` }
}

/** Saves one image of an observation. Idempotent: evidence is keyed by content hash and `intake_media` by (observation_id, position). */
const retainImageEffect = (store: CollectionStore, observationId: string, position: number, url: string, fetcher: typeof fetchInstagramImage) =>
  Effect.gen(function*() {
    const image = yield* importTry('intake.image', () => fetcher(url))
    yield* store.retainImage(observationId, position, image)
  })

export const retainPostsEffect = Effect.fn('intake.retainPosts')(function*(store: CollectionStore, runId: string, raw: unknown, usernames: string[], ceiling: number, fetcher: typeof fetchInstagramImage = fetchInstagramImage) {
  const posts = yield* Effect.try({ try: () => Schema.decodeUnknownSync(Schema.Array(PostSchema))(raw), catch: () => fail('Apify dataset has an invalid shape') })
  let changed = 0; let unchanged = 0; const failures: string[] = []; const seen = new Set<string>(); const observationIds = new Set<string>()
  const mediaFailed: MediaPosition[] = []
  const coverage = sourceCoverage(posts, usernames, ceiling)
  if (coverage.dead_sources.length) failures.push(`Sources not found or restricted (consider disabling): ${coverage.dead_sources.map(s => s.username).join(', ')}`)
  if (coverage.errored_sources.length) failures.push(`Sources returned errors: ${coverage.errored_sources.map(s => `${s.username} (${s.reason})`).join(', ')}`)
  if (coverage.uncovered_sources.length) failures.push(`Run stopped before covering ${coverage.uncovered_sources.length} sources; posts they published before the next run's window are not collected; raise run_cap_usd or reduce sources`)
  for (const post of posts) {
    if (post.error) continue
    if (!post.id || !post.shortCode) { failures.push('A requested profile returned an invalid post'); continue }
    if (seen.has(post.id)) continue; seen.add(post.id)
    const source = postSource(post, usernames)
    if (!source) { failures.push('A post owner did not match the configured source'); continue }
    const urls = mediaUrls(post)
    if (urls.length > 30) { failures.push('A post exceeded the supported carousel size'); continue }
    const hash = yield* importTry('intake.hash', () => sha256(JSON.stringify({ caption: post.caption ?? '', images: urls.map(url => { try { const u = new URL(url); return u.origin + u.pathname } catch { return url } }) })))
    const latest = yield* store.latestObservation(post.id)
    let observationId: string
    if (latest?.content_hash === hash) {
      observationId = latest.id
      yield* store.touchObservation(observationId)
      unchanged++
    } else {
      const observation = yield* store.upsertObservation({
        run_id: runId, post_id: post.id, source_username: source, post_url: `https://www.instagram.com/p/${post.shortCode}/`,
        caption: post.caption ?? '', published_at: post.timestamp ?? null, content_hash: hash, media_urls: urls,
      })
      observationId = observation.id; changed++
    }
    observationIds.add(observationId)
    const saved = yield* store.mediaPositions(observationId)
    for (let position = 0; position < urls.length; position++) {
      if (saved.includes(position)) continue
      const retained = yield* Effect.result(retainImageEffect(store, observationId, position, urls[position], fetcher))
      if (retained._tag === 'Failure') mediaFailed.push({ observation_id: observationId, position })
    }
  }
  return { posts: seen.size, changed, unchanged, failures, coverage, observationIds, mediaFailed }
})

/** Instagram's signed CDN URLs carry their expiry as `oe`, hex Unix seconds. Null when absent or unreadable. */
export function signedUrlExpiry(url: string): Date | null {
  try {
    const oe = new URL(url).searchParams.get('oe')
    return oe && /^[0-9a-f]{1,12}$/i.test(oe) ? new Date(parseInt(oe, 16) * 1000) : null
  } catch { return null }
}

export const MEDIA_RETRY_CAP = 20
// The whole retry pass, reads and uploads included, stops here; 20 failing downloads at 15 s alone would take 5 minutes.
export const MEDIA_RETRY_DEADLINE_MS = 4 * 60_000

export type MediaPosition = { observation_id: string; position: number }
/**
 * `failed`: positions that failed on an earlier collect and failed again on this retry, the only image problem worth a fix.
 * `expired`: positions whose stored URL expired (or is unreadable); nobody can recover them. `deferred`: left by the cap.
 */
type MediaRetry = { attempted: number; retained: number; failed: MediaPosition[]; expired: Array<MediaPosition & { expired_at: string | null }>;
  deferred: MediaPosition[]; error?: string }

/**
 * Collection only fetches posts newer than the last run, so an image that failed to save would never come back in a
 * dataset. This retries missing positions of unreviewed observations from their stored URLs, oldest first, at most
 * `cap` downloads a run. Expired URLs are skipped and reported, since Instagram rejects them.
 *
 * It never fails: a failed read, upload or upsert, or the deadline, ends the pass with `error` set and keeps what was
 * saved so far. A failed read is never reported as "nothing missing".
 */
export const retryMissingMediaEffect = (store: CollectionStore,
  options: { skip?: ReadonlySet<string>; fetcher?: typeof fetchInstagramImage; now?: Date; cap?: number; deadlineMs?: number } = {}) => {
  const { skip = new Set<string>(), fetcher = fetchInstagramImage, now = new Date(), cap = MEDIA_RETRY_CAP, deadlineMs = MEDIA_RETRY_DEADLINE_MS } = options
  const result: MediaRetry = { attempted: 0, retained: 0, failed: [], expired: [], deferred: [] }
  const pass = Effect.gen(function*() {
    const pending = (yield* store.unreviewedMedia()).filter(row => !skip.has(row.id) && Array.isArray(row.media_urls) && row.media_urls.length)
    yield* retryPositionsEffect(store, pending, result, { fetcher, now, cap })
  })
  return pass.pipe(
    Effect.timeoutOrElse({ duration: deadlineMs, orElse: () => Effect.sync(() => {
      result.error = `Media retry stopped at its ${Math.round(deadlineMs / 1000)} s deadline; the next collect continues it`
    }) }),
    Effect.catchCause(cause => Effect.sync(() => {
      const error = Cause.squash(cause)
      result.error = `Media retry stopped early: ${error instanceof Error ? error.message : String(error)}; the next collect retries`
    })),
    Effect.as(result),
  )
}

const retryPositionsEffect = Effect.fn('intake.retryMissingMedia')(function*(store: CollectionStore,
  pending: readonly UnreviewedMedia[], result: MediaRetry, { fetcher, now, cap }: { fetcher: typeof fetchInstagramImage; now: Date; cap: number }) {
  for (const observation of pending) {
    const urls = observation.media_urls as unknown[]
    for (let position = 0; position < urls.length; position++) {
      if (observation.positions.includes(position)) continue
      const url = urls[position]
      const expiry = typeof url === 'string' ? signedUrlExpiry(url) : null
      const item = { observation_id: observation.id, position }
      if (typeof url !== 'string' || expiry && expiry <= now) {
        result.expired.push({ ...item, expired_at: typeof url === 'string' ? expiry!.toISOString() : null })
        continue
      }
      if (result.attempted >= cap) { result.deferred.push(item); continue }
      result.attempted++
      const retained = yield* Effect.result(retainImageEffect(store, observation.id, position, url, fetcher))
      if (retained._tag === 'Success') result.retained++
      else result.failed.push(item)
    }
  }
})

/**
 * The Apify account's monthly usage limit is the spending cap. At the plan's included credit (the default) no run can
 * cause overage; raising the limit above it is how Hanif approves overage for a cycle.
 */
const checkCreditEffect = Effect.fn('intake.checkCredit')(function*(api: ApifyRequest, cap: number) {
  const limits = yield* importTry('apify.limits', () => api('GET', 'users/me/limits'))
  const limitsSchema = Schema.Struct({ data: Schema.Struct({
    limits: Schema.Struct({ maxMonthlyUsageUsd: Schema.Number }), current: Schema.Struct({ monthlyUsageUsd: Schema.Number }),
  }) })
  const headroom = yield* Effect.try({ try: () => {
    const { limits: limit, current } = Schema.decodeUnknownSync(limitsSchema)(limits).data
    return limit.maxMonthlyUsageUsd - current.monthlyUsageUsd
  }, catch: () => fail('Could not verify the Apify monthly usage limit') })
  if (headroom < cap + 0.02) return yield* fail('Apify monthly usage limit reached; no run started')
})

export const collectInstagramEffect = Effect.fn('intake.collect')(function*(store: CollectionStore, api: ApifyRequest,
  fetcher: typeof fetchInstagramImage = fetchInstagramImage) {
  const policy = yield* store.policy()
  if (!policy.collection_enabled) return yield* fail('Collection is disabled; finish deployment and configuration first')
  const reservation = yield* store.reserveCollection()
  let runId = reservation.apify_run_id
  if (reservation.fresh) {
    // Existing runs can still be retrieved when no credit remains for a new run.
    yield* checkCreditEffect(api, Number(reservation.reserved_usd))
    const started = yield* importTry('apify.start', () => api('POST', 'actors/apify~instagram-post-scraper/runs', {
      // A 200-account run took about 200 s, so 300 s would time out a ~160-source watchlist and waste the charged rows.
      maxTotalChargeUsd: Number(reservation.reserved_usd), build: reservation.actor_build, timeout: 1800, memory: 1024, restartOnError: false,
    }, reservation.input))
    const run = yield* Effect.try({ try: () => readRun(started), catch: () => fail('Unknown Apify start result; reconcile the reserved run before retrying') })
    runId = run.id
    yield* store.updateRun(reservation.id, { apify_run_id: run.id, dataset_id: run.defaultDatasetId, state: 'started' })
  }
  if (!runId) return yield* fail('A previous run has an unknown start outcome; do not start another paid run')
  const status = yield* importTry('apify.status', () => api('GET', `actor-runs/${runId}`, { waitForFinish: 30 }))
  const run = yield* Effect.try({ try: () => readRun(status), catch: () => fail('Invalid Apify run status') })
  if (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(run.status)) return { state: 'running', run_id: runId }
  if (run.status !== 'SUCCEEDED') {
    yield* store.updateRun(reservation.id, { state: 'failed', charged_usd: run.usageTotalUsd ?? null })
    return yield* fail('Apify collection did not succeed; the existing reservation remains recorded')
  }
  const items: unknown[] = []
  for (let offset = 0; ; offset += 500) {
    const page = yield* importTry('apify.dataset', () => api('GET', `datasets/${run.defaultDatasetId}/items`, { format: 'json', clean: true, offset, limit: 500 }))
    if (!Array.isArray(page) || offset >= 10000) return yield* fail('Dataset incomplete or larger than the supported bound')
    items.push(...page); if (page.length < 500) break
  }
  const { observationIds, mediaFailed, ...result } = yield* retainPostsEffect(store, reservation.id, items, reservation.input.username, Number(reservation.input.resultsLimit), fetcher)
  yield* store.updateRun(reservation.id, { state: 'succeeded', charged_usd: run.usageTotalUsd ?? null, completed_at: new Date().toISOString() })
  // After the run is recorded, so a failed retry can't leave it unfinished. Posts in today's dataset were just tried with
  // fresh URLs; every other unreviewed observation gets one retry per collect, including a resumed or repeated one.
  const retry = yield* retryMissingMediaEffect(store, { skip: observationIds, fetcher })
  if (retry.error) result.failures.push(retry.error)
  return { state: 'succeeded', run_id: runId, scope: 'posts since 2 hours before the last successful run started (7 days with none, at most 30), capped per source; stories and video audio excluded', ...result,
    media: {
      first_attempt_failed: mediaFailed, // today's posts; the next collect retries them, so not a fix yet
      retry: { attempted: retry.attempted, retained: retry.retained, ...(retry.error ? { error: retry.error } : {}) },
      retried_failed: retry.failed, expired: retry.expired, deferred: retry.deferred,
    } }
})
