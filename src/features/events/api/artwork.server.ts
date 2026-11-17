import { ARTWORK_WIDTHS, R2_ARTWORK_KEY, artworkVersion, isArtworkOriginAllowed, r2ArtworkKey } from '../lib/artwork-delivery.ts'
import type { PublicCache } from './platform-cache.ts'

type CatalogArtwork = { image_url: string | null } | null
// Structural platform boundary avoids incompatible DOM/Workers stream declaration copies.
export type ArtworkImages = {
  info: (stream: ReadableStream<Uint8Array<ArrayBuffer>>) => Promise<{ width?: number; height?: number; format?: string; fileSize?: number }>
  input: (stream: ReadableStream<Uint8Array<ArrayBuffer>>) => {
    transform: (options: { width: number; fit: 'scale-down' }) => {
      output: (options: { format: 'image/webp'; quality: number; anim: false }) => Promise<{
        response: (options: { headers: HeadersInit }) => Response
      }>
    }
  }
}
/** The R2 artwork bucket (binding `ARTWORK`), as far as the route reads it. */
export type ArtworkBucket = {
  get: (key: string) => Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>
}
type Options = {
  request: Request
  id: string
  variant: string
  images?: ArtworkImages
  cache?: PublicCache
  retain?: (task: Promise<unknown>) => void
  lookup: (id: string, signal: AbortSignal) => Promise<CatalogArtwork>
  fetchImage?: typeof fetch
  ownedStorageOrigin?: string
  /** Bound only on a Worker that binds D1 (staging until the cutover), where artwork lives in R2. */
  bucket?: ArtworkBucket
}
const MAX_BYTES = 10 * 1024 * 1024
const MAX_PIXELS = 40_000_000

async function boundedBytes(response: Response): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.body || Number(response.headers.get('Content-Length')) > MAX_BYTES) throw new Error('Artwork too large')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_BYTES) throw new Error('Artwork too large')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return bytes
}

/** Direct Cache/Images platform adapter. Only catalog IDs and finite variants are accepted. */
export async function serveArtwork(options: Options): Promise<Response> {
  const { request, id, variant, images, cache, retain, lookup } = options
  const url = new URL(request.url)
  if (R2_ARTWORK_KEY.test(variant)) return serveOriginal(options, url)
  const width = Number(variant.replace('.webp', ''))
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ||
    !ARTWORK_WIDTHS.some((allowed) => variant === `${allowed}.webp`) ||
    [...url.searchParams.keys()].some((key) => key !== 'v') || url.searchParams.getAll('v').length !== 1 ||
    !/^[a-z0-9]{1,7}$/.test(url.searchParams.get('v') ?? '')) {
    return new Response('Invalid artwork request', { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }
  const key = new Request(`https://baeventos.com/api/event-artwork/${id}/${variant}?v=${url.searchParams.get('v')}`)
  const cached = await cache?.match(key).catch(() => undefined)
  if (cached) {
    const response = new Response(cached.body, cached)
    response.headers.set('X-Artwork-Cache', 'HIT')
    return response
  }
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)])
  let original: string | undefined
  try {
    const event = await lookup(id, signal)
    if (!event?.image_url || !isArtworkOriginAllowed(event.image_url, options.ownedStorageOrigin)) {
      return new Response('Artwork unavailable', { status: 404, headers: { 'Cache-Control': 'no-store' } })
    }
    original = event.image_url
    if (url.searchParams.get('v') !== artworkVersion(original)) {
      return new Response('Artwork changed', { status: 404, headers: { 'Cache-Control': 'no-store' } })
    }
    if (!images) throw new Error('Images binding unavailable')
    const r2Key = r2ArtworkKey(original)
    // Do not forward user cookies/authentication; do not follow upstream redirects.
    const source = r2Key ? await r2Image(options.bucket, r2Key)
      : await (options.fetchImage ?? fetch)(original, { redirect: 'manual', signal, headers: { Accept: 'image/*' } })
    if (!source.ok || !/^image\/(jpeg|png|webp|gif|avif)(?:;|$)/i.test(source.headers.get('Content-Type') ?? '')) {
      await source.body?.cancel()
      throw new Error('Artwork source unavailable')
    }
    const bytes = await boundedBytes(source)
    const metadata = await images.info(new Response(bytes).body!)
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_PIXELS) {
      throw new Error('Artwork dimensions exceed limit')
    }
    const targetWidth = Math.min(width, metadata.width)
    const transformed = await images.input(new Response(bytes).body!)
      .transform({ width: targetWidth, fit: 'scale-down' })
      .output({ format: 'image/webp', quality: 75, anim: false })
    const response = transformed.response({ headers: {
      'Cache-Control': 'public, max-age=86400',
      'Content-Type': 'image/webp',
      'X-Content-Type-Options': 'nosniff',
      'X-Artwork-Width': String(targetWidth),
      'X-Artwork-Height': String(Math.round(metadata.height * targetWidth / metadata.width)),
      'X-Artwork-Cache': 'MISS',
    } })
    if (cache) {
      const store = cache.put(key, response.clone()).catch(() => {})
      if (retain) retain(store)
      else await store
    }
    return response
  } catch {
    // Includes free transformation quota exhaustion. Never cache an error/fallback as a derivative.
    // An R2 original is served by this route on this host (staging has its own), so redirect by path.
    if (original && !signal.aborted) return new Response(null, {
      status: 307, headers: { Location: r2ArtworkKey(original) ? new URL(original).pathname : original, 'Cache-Control': 'no-store', 'X-Artwork-Cache': 'FALLBACK' },
    })
    return new Response('Artwork temporarily unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}

/** An R2 artwork object as a fetch response, so it takes the same bounded path as a fetched image. */
async function r2Image(bucket: ArtworkBucket | undefined, key: string): Promise<Response> {
  const object = await bucket?.get(key)
  if (!object) throw new Error('Artwork object unavailable')
  return new Response(object.body, { headers: { 'Content-Type': object.httpMetadata?.contentType ?? '' } })
}

const unavailable = () => new Response('Artwork unavailable', { status: 404, headers: { 'Cache-Control': 'no-store' } })

/**
 * The original of an R2 artwork, `/api/event-artwork/<event id>/<sha256>.<ext>`: the URL the copy tool and the D1
 * intake write to `events.image_url`. It is served only while it is the displayable event's current artwork. The key
 * is the content's hash, so the response never changes and is cached for a year.
 */
async function serveOriginal(options: Options, url: URL): Promise<Response> {
  const { id, variant } = options
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) || url.search) {
    return new Response('Invalid artwork request', { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }
  if (!options.bucket) return unavailable()
  try {
    const signal = AbortSignal.any([options.request.signal, AbortSignal.timeout(10_000)])
    const event = await options.lookup(id, signal)
    if (!event?.image_url || r2ArtworkKey(event.image_url, id) !== variant) return unavailable()
    const object = await options.bucket.get(variant)
    if (!object) return unavailable()
    const type = object.httpMetadata?.contentType ?? ''
    if (!/^image\/(jpeg|png|webp)$/i.test(type)) {
      await object.body.cancel()
      return unavailable()
    }
    return new Response(object.body, { headers: {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Type': type,
      'X-Content-Type-Options': 'nosniff',
    } })
  } catch {
    return new Response('Artwork temporarily unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
