import { ARTWORK_WIDTHS, artworkVersion, isArtworkOriginAllowed } from '../lib/artwork-delivery.ts'
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
    // Do not forward user cookies/authentication; do not follow upstream redirects.
    const source = await (options.fetchImage ?? fetch)(original, { redirect: 'manual', signal, headers: { Accept: 'image/*' } })
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
    if (original && !signal.aborted) return new Response(null, {
      status: 307, headers: { Location: original, 'Cache-Control': 'no-store', 'X-Artwork-Cache': 'FALLBACK' },
    })
    return new Response('Artwork temporarily unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
