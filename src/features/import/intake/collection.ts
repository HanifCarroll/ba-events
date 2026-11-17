import { Effect, Schema } from 'effect'
import { importTry, ImportOperationError } from '../core/effect-utils.ts'
import type { CollectionStore } from './store.ts'

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

export const retainPostsEffect = Effect.fn('intake.retainPosts')(function*(store: CollectionStore, runId: string, raw: unknown, usernames: string[], ceiling: number, fetcher: typeof fetchInstagramImage = fetchInstagramImage) {
  const posts = yield* Effect.try({ try: () => Schema.decodeUnknownSync(Schema.Array(PostSchema))(raw), catch: () => fail('Apify dataset has an invalid shape') })
  let changed = 0; let unchanged = 0; const failures: string[] = []; const seen = new Set<string>()
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
    const saved = yield* store.mediaPositions(observationId)
    for (let position = 0; position < urls.length; position++) {
      if (saved.includes(position)) continue
      const retained = yield* Effect.result(Effect.gen(function*() {
        const image = yield* importTry('intake.image', () => fetcher(urls[position]))
        yield* store.retainImage(observationId, position, image)
      }))
      if (retained._tag === 'Failure') failures.push(`Media ${position} could not be retained for observation ${observationId}`)
    }
  }
  return { posts: seen.size, changed, unchanged, failures, coverage }
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
  const result = yield* retainPostsEffect(store, reservation.id, items, reservation.input.username, Number(reservation.input.resultsLimit), fetcher)
  yield* store.updateRun(reservation.id, { state: 'succeeded', charged_usd: run.usageTotalUsd ?? null, completed_at: new Date().toISOString() })
  return { state: 'succeeded', run_id: runId, scope: 'posts since 2 hours before the last successful run started (7 days with none, at most 30), capped per source; stories and video audio excluded', ...result }
})
