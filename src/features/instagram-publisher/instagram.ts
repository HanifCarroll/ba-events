/**
 * Idempotent publishing through the Instagram Graph API on graph.facebook.com, with the app's system-user token from
 * Facebook Login for Business (new Meta apps only offer that "Unified login" setup; graph.instagram.com refuses its tokens).
 * Every id is saved before the next step. A media_publish without a clear answer marks the unit `pendingSince`; the
 * next attempt reads that container's own `status_code` before anything else. PUBLISHED means this attempt went out;
 * FINISHED means it didn't, and the same container (which can only publish once) is retried; anything else holds.
 * Recent media is consulted only to find a published carousel's id by its exact caption, never to decide whether to post.
 * `beforeWrite` runs before every new write (container, carousel, media_publish), never before a reconciling read.
 */

export const GRAPH = 'https://graph.facebook.com/v27.0'
export const PROFILE_URL = 'https://www.instagram.com/baeventos.app/'

export class InstagramError extends Error {
  /** True when Instagram answered with an error, so the call certainly had no effect. */
  constructor(message: string, readonly definite: boolean) { super(message) }
}

/** The HTTP seam. `params` never reach a log: errors carry only Instagram's message. */
export interface InstagramApi {
  get(path: string, params?: Record<string, string>): Promise<any>
  post(path: string, params: Record<string, string>): Promise<any>
}

export function instagramApi(accessToken: string, fetchImpl: typeof fetch = fetch, timeoutMs = 60_000): InstagramApi {
  const call = async (method: 'GET' | 'POST', path: string, params: Record<string, string>) => {
    const body = new URLSearchParams({ ...params, access_token: accessToken })
    const url = method === 'GET' ? `${GRAPH}/${path}?${body}` : `${GRAPH}/${path}`
    let response: Response
    try {
      response = await fetchImpl(url, { method, body: method === 'POST' ? body : undefined, signal: AbortSignal.timeout(timeoutMs) })
    } catch (error) {
      throw new InstagramError(`${method} ${path}: no response (${(error as Error).name})`, false)
    }
    const json = await response.json().catch(() => null) as any
    if (response.ok && json && !json.error) return json
    const message = json?.error?.message ?? `HTTP ${response.status}`
    // A 4xx with Instagram's error body means the request was refused; a 5xx or garbled body might have done something.
    throw new InstagramError(`${method} ${path}: ${message}`, response.status >= 400 && response.status < 500 && Boolean(json?.error))
  }
  return { get: (path, params = {}) => call('GET', path, params), post: (path, params) => call('POST', path, params) }
}

export interface Slide { url: string; tag: { username: string; x: number; y: number } | null }

/** One media_publish call: a carousel, or one story frame. */
export interface PublishUnit {
  childIds?: Array<string | null>
  containerId: string | null
  mediaId: string | null
  /** True once this unit is known to be out, even when its media id couldn't be learned. */
  published?: boolean
  /** Set just before media_publish; cleared once the outcome is known. */
  pendingSince: string | null
}

export interface PublishState { units: PublishUnit[]; permalink: string | null }

export interface PublishJob {
  kind: 'story' | 'carousel'
  igUserId: string
  slides: Slide[]
  caption: string | null
}

export interface PublishDeps {
  api: InstagramApi
  /** Persist state; called after every step. */
  save(state: PublishState): Promise<void> | void
  now(): Date
  sleep(ms: number): Promise<void>
  log(message: string): void
  /** Throws to stop before a new Instagram write (approval withdrawn, ❌, or past the deadline). */
  beforeWrite(): Promise<void>
}

export const emptyPublishState = (job: PublishJob): PublishState => ({
  units: job.kind === 'carousel'
    ? [{ childIds: job.slides.map(() => null), containerId: null, mediaId: null, pendingSince: null }]
    : job.slides.map(() => ({ containerId: null, mediaId: null, pendingSince: null })),
  permalink: null,
})

const tagsParam = (slide: Slide, story: boolean): Record<string, string> =>
  slide.tag ? { user_tags: JSON.stringify([story ? { username: slide.tag.username } : slide.tag]) } : {}

async function waitFinished(id: string, deps: PublishDeps): Promise<'FINISHED' | 'PUBLISHED' | 'EXPIRED' | 'ERROR'> {
  // Meta suggests polling once a minute for up to 5 minutes; images are usually ready at once, so start faster.
  for (let attempt = 0; attempt < 12; attempt++) {
    const { status_code: status } = await deps.api.get(id, { fields: 'status_code' })
    if (status === 'FINISHED' || status === 'PUBLISHED' || status === 'EXPIRED' || status === 'ERROR') return status
    await deps.sleep(attempt < 4 ? 5_000 : 30_000)
  }
  throw new InstagramError(`container ${id} did not finish in time`, false)
}

async function checkQuota(job: PublishJob, deps: PublishDeps) {
  const response = await deps.api.get(`${job.igUserId}/content_publishing_limit`, { fields: 'quota_usage,config' })
  const usage = response?.data?.[0]?.quota_usage ?? 0
  const total = response?.data?.[0]?.config?.quota_total ?? 50
  if (usage >= total) throw new InstagramError(`publishing limit reached (${usage}/${total} in 24 hours)`, true)
}

/** A published carousel's media id: the one recent post with exactly this caption, newer than the attempt. */
async function findCarousel(job: PublishJob, unit: PublishUnit, state: PublishState, deps: PublishDeps): Promise<string | null> {
  const since = Date.parse(unit.pendingSince!) - 2 * 60_000
  const { data = [] } = await deps.api.get(`${job.igUserId}/media`, { fields: 'id,caption,timestamp', limit: '25' })
  const known = new Set(state.units.map(other => other.mediaId).filter(Boolean))
  const matches = (data as Array<{ id: string; caption?: string; timestamp: string }>)
    .filter(media => !known.has(media.id) && Date.parse(media.timestamp) >= since && (media.caption ?? '') === (job.caption ?? ''))
  return matches.length === 1 ? matches[0]!.id : null
}

async function createContainer(job: PublishJob, unitIndex: number, state: PublishState, deps: PublishDeps): Promise<string> {
  const unit = state.units[unitIndex]!
  if (job.kind === 'story') {
    const slide = job.slides[unitIndex]!
    await deps.beforeWrite()
    const { id } = await deps.api.post(`${job.igUserId}/media`, { media_type: 'STORIES', image_url: slide.url, ...tagsParam(slide, true) })
    return id
  }
  const children = unit.childIds!
  for (const [index, slide] of job.slides.entries()) {
    if (children[index]) continue
    await deps.beforeWrite()
    const { id } = await deps.api.post(`${job.igUserId}/media`, { image_url: slide.url, is_carousel_item: 'true', ...tagsParam(slide, false) })
    children[index] = id
    await deps.save(state)
  }
  for (const [index, child] of children.entries()) {
    const status = await waitFinished(child!, deps)
    if (status !== 'FINISHED') { children[index] = null; await deps.save(state); throw new InstagramError(`slide ${index + 1} container is ${status}`, true) }
  }
  await deps.beforeWrite()
  const { id } = await deps.api.post(`${job.igUserId}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption: job.caption ?? '' })
  return id
}

async function publishUnit(job: PublishJob, unitIndex: number, state: PublishState, deps: PublishDeps) {
  const unit = state.units[unitIndex]!
  if (unit.mediaId || unit.published) return
  if (unit.pendingSince) {
    const status = unit.containerId ? (await deps.api.get(unit.containerId, { fields: 'status_code' })).status_code : null
    if (status === 'PUBLISHED') {
      unit.published = true
      unit.mediaId = job.kind === 'carousel' ? await findCarousel(job, unit, state, deps) : null
      deps.log(`unit ${unitIndex + 1}: container ${unit.containerId} reads PUBLISHED after the unclear attempt at ${unit.pendingSince}`)
      unit.pendingSince = null
      await deps.save(state)
      return
    }
    if (status === 'FINISHED' && job.kind === 'carousel') {
      // Belt and braces for a carousel: its exact caption among posts since the attempt means it did go out.
      const found = await findCarousel(job, unit, state, deps)
      if (found) { unit.mediaId = found; unit.published = true; unit.pendingSince = null; await deps.save(state); return }
    }
    if (status === 'EXPIRED' || status === 'ERROR') {
      unit.containerId = null
      if (unit.childIds) unit.childIds = unit.childIds.map(() => null)
    } else if (status !== 'FINISHED') {
      throw new InstagramError(`unit ${unitIndex + 1}: container ${unit.containerId} is ${status ?? 'unknown'} after an unclear media_publish; holding until it settles`, false)
    }
    unit.pendingSince = null
    await deps.save(state)
  }
  if (unit.containerId) {
    const status = await waitFinished(unit.containerId, deps)
    if (status === 'PUBLISHED') throw new InstagramError(`container ${unit.containerId} is already PUBLISHED; not retrying`, false)
    if (status !== 'FINISHED') { unit.containerId = null; if (unit.childIds) unit.childIds = unit.childIds.map(() => null); await deps.save(state) }
  }
  if (!unit.containerId) {
    unit.containerId = await createContainer(job, unitIndex, state, deps)
    await deps.save(state)
    const status = await waitFinished(unit.containerId, deps)
    if (status !== 'FINISHED') { unit.containerId = null; await deps.save(state); throw new InstagramError(`container is ${status}`, true) }
  }
  await checkQuota(job, deps)
  await deps.beforeWrite()
  unit.pendingSince = deps.now().toISOString()
  await deps.save(state)
  try {
    const { id } = await deps.api.post(`${job.igUserId}/media_publish`, { creation_id: unit.containerId })
    unit.mediaId = id
    unit.published = true
    unit.pendingSince = null
  } catch (error) {
    if (error instanceof InstagramError && error.definite) unit.pendingSince = null
    throw error
  } finally {
    await deps.save(state)
  }
}

/** Publish (or finish publishing) a draft. Returns the permalink of the post, or of the first story frame. */
export async function publish(job: PublishJob, state: PublishState, deps: PublishDeps): Promise<string> {
  for (let index = 0; index < state.units.length; index++) await publishUnit(job, index, state, deps)
  if (!state.permalink) {
    const first = state.units[0]!.mediaId
    const permalink = first ? (await deps.api.get(first, { fields: 'permalink' })).permalink : null
    state.permalink = permalink ?? PROFILE_URL
    await deps.save(state)
  }
  return state.permalink!
}

/** Tag position: the centre of the footer text ("@handle" or "Vía @handle" at left 80px, 72px from the bottom, 28px DM Sans). */
export function footerTag(handle: string, height: number, footerText = `@${handle}`): Slide['tag'] {
  const textWidth = footerText.length * 15
  return { username: handle, x: Number(((80 + textWidth / 2) / 1080).toFixed(3)), y: Number(((height - 72 - 18) / height).toFixed(3)) }
}
