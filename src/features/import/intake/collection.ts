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

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
class InstagramConnectionError extends Error {}
const CONNECTION_ERRORS = new Set(['ConnectionRefused', 'FailedToOpenSocket', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH',
  'ENETDOWN', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT',
  'ConnectionClosed', 'SocketClosed', 'ERR_SOCKET_CLOSED', 'UND_ERR_SOCKET'])
const isTimeout = (error: unknown) => error instanceof Error && error.name === 'TimeoutError'
const errorCode = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined

/**
 * Direct network adapter: no redirects, credentials, SVG or unbounded downloads. Its error message is the short reason
 * `collect` reports for a failed image (`answered 403`, `timed out after 15 s`, `redirected`, ...).
 */
export async function fetchInstagramImage(url: string, fetcher: typeof fetch = fetch) {
  if (!allowedInstagramMedia(url)) throw new Error('Unsupported Instagram media origin')
  let response: Response
  const signal = AbortSignal.timeout(15000)
  try {
    // Manual, not 'error', so a redirect is named; it is still never followed.
    response = await fetcher(url, { redirect: 'manual', signal, headers: { Accept: 'image/jpeg,image/png,image/webp' } })
  } catch (error) {
    // A timeout here is before headers. The separate body reader never raises a fallback error.
    const cause = error instanceof Error ? error.cause : undefined
    const reason = signal.aborted ? signal.reason : isTimeout(cause) ? cause : error
    if (isTimeout(reason) || CONNECTION_ERRORS.has(errorCode(error) ?? errorCode(cause) ?? '')) {
      throw new InstagramConnectionError(downloadReason(reason))
    }
    throw new Error(downloadReason(error))
  }
  if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new Error('redirected') }
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error(`answered ${response.status}`) }
  if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) { await response.body.cancel(); throw new Error('over 10 MB') }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break
      length += value.byteLength; if (length > MAX_IMAGE_BYTES) throw new Error('over 10 MB')
      chunks.push(value)
    }
  } catch (error) { throw new Error(downloadReason(error)) } finally { await reader.cancel().catch(() => {}) }
  const bytes = new Uint8Array(length); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  try { return await describeImage(bytes) } catch {
    throw new Error(`not an image (${response.headers.get('content-type') ?? 'no content type'})`)
  }
}
const downloadReason = (error: unknown) => {
  if (isTimeout(error)) return 'timed out after 15 s'
  const code = errorCode(error) ?? (error instanceof Error ? errorCode(error.cause) : undefined)
  return `${error instanceof Error ? error.message : String(error)}${code ? ` (${code})` : ''}`
}

/** Evidence image identity from its bytes alone: JPEG, PNG or WebP by magic number, keyed by its sha256. */
export async function describeImage(bytes: Uint8Array<ArrayBuffer>) {
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('Image exceeds limit')
  const type = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'jpeg' :
    bytes[0] === 137 && String.fromCharCode(...bytes.slice(1, 4)) === 'PNG' ? 'png' :
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP' ? 'webp' : null
  if (!type) throw new Error('Unsupported image bytes')
  const hash = await sha256(bytes)
  return { bytes, content_type: `image/${type}`, sha256: hash, object_key: `${hash}.${type === 'jpeg' ? 'jpg' : type}` }
}

/** Retain one position; download failures are per-image, but API/storage failures can stop the retry pass. */
const retainPositionEffect = Effect.fn('intake.retainPosition')(function*(store: CollectionStore, item: MediaPosition, url: string,
  fetcher: typeof fetchInstagramImage, now = new Date()) {
  const { observation_id: id, position } = item
  const image = yield* Effect.result(importTry('intake.image', () => fetcher(url)))
  if (image._tag === 'Success') {
    yield* store.retainImage(id, position, image.success)
    return { status: 'direct' } as const
  }
  const { cause, message } = image.failure
  const expiry = signedUrlExpiry(url)
  if (store.fetchAndRetainImage && cause instanceof InstagramConnectionError && (!expiry || expiry > now)) {
    const reason = yield* store.fetchAndRetainImage(id, position)
    return reason === null ? { status: 'server' } as const : { status: 'failed', reason: `${message}; Worker fallback: ${reason}` } as const
  }
  return { status: 'failed', reason: message } as const
})

// Posts saved at once. Sequential saving took 30+ minutes for a normal day of ~300 posts (mostly image round trips).
export const RETAIN_CONCURRENCY = 6

export const retainPostsEffect = Effect.fn('intake.retainPosts')(function*(store: CollectionStore, runId: string, raw: unknown, usernames: string[], ceiling: number, fetcher: typeof fetchInstagramImage = fetchInstagramImage) {
  const posts = yield* Effect.try({ try: () => Schema.decodeUnknownSync(Schema.Array(PostSchema))(raw), catch: () => fail('Apify dataset has an invalid shape') })
  let changed = 0; let unchanged = 0; const failures: string[] = []; const seen = new Set<string>(); const observationIds = new Set<string>()
  const mediaFailed: FailedMedia[] = []
  const serverFetched: MediaPosition[] = []
  const coverage = sourceCoverage(posts, usernames, ceiling)
  if (coverage.dead_sources.length) failures.push(`Sources not found or restricted (consider disabling): ${coverage.dead_sources.map(s => s.username).join(', ')}`)
  if (coverage.errored_sources.length) failures.push(`Sources returned errors: ${coverage.errored_sources.map(s => `${s.username} (${s.reason})`).join(', ')}`)
  if (coverage.uncovered_sources.length) failures.push(`Run stopped before covering ${coverage.uncovered_sources.length} sources; posts they published before the next run's window are not collected; raise run_cap_usd or reduce sources`)
  const work: Array<{ post: Post & { id: string; shortCode: string }; source: string; urls: string[]; hash: string }> = []
  for (const post of posts) {
    if (post.error) continue
    if (!post.id || !post.shortCode) { failures.push('A requested profile returned an invalid post'); continue }
    // Deduplicated here, before dispatch, so two copies of one post (a collab under two accounts) never run concurrently.
    if (seen.has(post.id)) continue; seen.add(post.id)
    const source = postSource(post, usernames)
    if (!source) { failures.push('A post owner did not match the configured source'); continue }
    const urls = mediaUrls(post)
    if (urls.length > 30) { failures.push('A post exceeded the supported carousel size'); continue }
    const hash = yield* importTry('intake.hash', () => sha256(JSON.stringify({ caption: post.caption ?? '', images: urls.map(url => { try { const u = new URL(url); return u.origin + u.pathname } catch { return url } }) })))
    work.push({ post: { ...post, id: post.id, shortCode: post.shortCode }, source, urls, hash })
  }
  const retained = yield* Effect.forEach(work, ({ post, source, urls, hash }) => Effect.gen(function*() {
    const latest = yield* store.latestObservation(post.id)
    const fresh = latest?.content_hash !== hash
    let observationId: string
    if (!fresh) {
      observationId = latest!.id
      yield* store.touchObservation(observationId)
    } else {
      const observation = yield* store.upsertObservation({
        run_id: runId, post_id: post.id, source_username: source, post_url: `https://www.instagram.com/p/${post.shortCode}/`,
        caption: post.caption ?? '', published_at: post.timestamp ?? null, content_hash: hash, media_urls: urls,
      })
      observationId = observation.id
    }
    const saved = yield* store.mediaPositions(observationId)
    const failed: FailedMedia[] = []
    const fetched: MediaPosition[] = []
    // A post's images stay sequential; RETAIN_CONCURRENCY posts at a time already bounds parallel downloads and uploads.
    for (let position = 0; position < urls.length; position++) {
      if (saved.includes(position)) continue
      const item = { observation_id: observationId, position }
      const image = yield* Effect.result(retainPositionEffect(store, item, urls[position], fetcher))
      if (image._tag === 'Failure') failed.push({ ...item, reason: image.failure.message })
      else if (image.success.status === 'failed') failed.push({ ...item, reason: image.success.reason })
      else if (image.success.status === 'server') fetched.push(item)
    }
    return { observationId, fresh, failed, fetched }
  }), { concurrency: RETAIN_CONCURRENCY })
  for (const { observationId, fresh, failed, fetched } of retained) {
    if (fresh) changed++; else unchanged++
    observationIds.add(observationId); mediaFailed.push(...failed); serverFetched.push(...fetched)
  }
  return { posts: seen.size, changed, unchanged, failures, coverage, observationIds, mediaFailed, serverFetched }
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
export type FailedMedia = MediaPosition & { reason: string }
/**
 * `failed`: positions that failed on an earlier collect and failed again on this retry, the only image problem worth a fix.
 * `expired`: positions whose stored URL expired (or is unreadable); nobody can recover them. `deferred`: left by the cap.
 */
type MediaRetry = { attempted: number; retained: number; failed: FailedMedia[]; expired: Array<MediaPosition & { expired_at: string | null }>;
  deferred: MediaPosition[]; serverFetched: MediaPosition[]; error?: string }

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
  const result: MediaRetry = { attempted: 0, retained: 0, failed: [], expired: [], deferred: [], serverFetched: [] }
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
      const where = error instanceof ImportOperationError ? ` (in ${error.operation})` : ''
      result.error = `Media retry stopped early: ${error instanceof Error ? error.message : String(error)}${where}; the next collect retries`
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
      const image = yield* retainPositionEffect(store, item, url, fetcher, now)
      if (image.status === 'failed') { result.failed.push({ ...item, reason: image.reason }); continue }
      if (image.status === 'server') result.serverFetched.push(item)
      result.retained++
    }
  }
})

const limitsSchema = Schema.Struct({ data: Schema.Struct({
  limits: Schema.Struct({ maxMonthlyUsageUsd: Schema.Number }), current: Schema.Struct({ monthlyUsageUsd: Schema.Number }),
}) })
const apifyCycleEffect = Effect.fn('intake.apifyCycle')(function*(api: ApifyRequest) {
  const limits = yield* importTry('apify.limits', () => api('GET', 'users/me/limits'))
  return yield* Effect.try({ try: () => {
    const { limits: limit, current } = Schema.decodeUnknownSync(limitsSchema)(limits).data
    return { limit_usd: limit.maxMonthlyUsageUsd, usage_usd: current.monthlyUsageUsd }
  }, catch: () => fail('Could not verify the Apify monthly usage limit') })
})

/** The account usage limit caps new runs; the intake ledger separately caps its own calendar-month spend. */
const checkCreditEffect = Effect.fn('intake.checkCredit')(function*(api: ApifyRequest, cap: number) {
  const { limit_usd, usage_usd } = yield* apifyCycleEffect(api)
  if (limit_usd - usage_usd < cap + 0.02) return yield* fail('Apify monthly usage limit reached; no run started')
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
  const { observationIds, mediaFailed, serverFetched, ...result } = yield* retainPostsEffect(store, reservation.id, items, reservation.input.username, Number(reservation.input.resultsLimit), fetcher)
  const charged_usd = run.usageTotalUsd ?? null
  const month = yield* store.updateRun(reservation.id, { state: 'succeeded', charged_usd, completed_at: new Date().toISOString() })
  // After the run is recorded, so a failed retry can't leave it unfinished. Posts in today's dataset were just tried with
  // fresh URLs; every other unreviewed observation gets one retry per collect, including a resumed or repeated one.
  const retry = yield* retryMissingMediaEffect(store, { skip: observationIds, fetcher })
  if (retry.error) result.failures.push(retry.error)
  // This read is for reporting only; an unavailable account snapshot cannot undo completed collection.
  const cycle = yield* Effect.result(apifyCycleEffect(api))
  return { state: 'succeeded', run_id: runId, charged_usd, month: month ? { ...month, cap_usd: policy.monthly_cap_usd } : null,
    apify_cycle: cycle._tag === 'Success' ? cycle.success : null,
    scope: 'posts since 2 hours before the last successful run started (7 days with none, at most 30), capped per source; stories and video audio excluded', ...result,
    media: {
      first_attempt_failed: mediaFailed, // today's posts; the next collect retries them, so not a fix yet
      retry: { attempted: retry.attempted, retained: retry.retained, ...(retry.error ? { error: retry.error } : {}) },
      retried_failed: retry.failed, expired: retry.expired, deferred: retry.deferred,
      server_fetched: [...serverFetched, ...retry.serverFetched],
    } }
})
