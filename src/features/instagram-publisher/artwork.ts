/**
 * Each event's flyer, downloaded and prepared before a render: only from the catalog's known image origins (our R2
 * route and the listed CDNs; redirects too, at most three), 10 s for the whole download, at most 15 MB, and it must
 * decode as an image. A flyer that fails leaves its event without artwork
 * (it gets the no-flyer card) and is logged. Only a broken setup throws: no `sharp`, or a directory that can't be made.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isArtworkOriginAllowed } from '../events/lib/artwork-delivery.ts'
import type { PostEvent } from './select.ts'

/** A prepared flyer: the image (at most 1280 px on its long side, more than any frame shows it at) and a small blurred, darkened copy to sit behind it. */
export interface Art { file: string; backdrop: string; width: number; height: number }
/** Prepared artwork by event id. An event without an entry renders the no-flyer card. */
export type Artwork = Record<string, Art>

const TIMEOUT_MS = 10_000
const MAX_BYTES = 15 * 1024 * 1024
const MAX_PIXELS = 25_000_000
const LONG_SIDE = 1280
/** Smaller than this on its short side is an icon or a placeholder, not a flyer. */
const MIN_SIDE = 200
const FORMATS = ['jpeg', 'png', 'webp', 'gif', 'heif']

const MAX_REDIRECTS = 3
const isHttps = (url: string) => URL.canParse(url) && new URL(url).protocol === 'https:'

/**
 * This job runs on the VPS before anyone has approved the draft, so it only ever connects to the catalog's known image
 * origins. https alone would let a catalog URL, or a redirect, point it at an internal service.
 */
const refusal = (url: string) => !isHttps(url) ? 'not an https URL' : !isArtworkOriginAllowed(url) ? 'not an allowed artwork origin' : null

/** Redirects are followed by hand, so every hop is checked before it is requested. One timeout covers the whole chain. */
export async function downloadArtwork(url: string, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  const refused = refusal(url)
  if (refused) throw new Error(refused)
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  let response = await fetchImpl(url, { signal, redirect: 'manual' })
  for (let hops = 0; response.status >= 300 && response.status < 400; hops++) {
    const location = response.headers.get('location')
    await response.body?.cancel().catch(() => undefined)
    if (!location) throw new Error(`HTTP ${response.status} without a Location`)
    if (hops === MAX_REDIRECTS) throw new Error(`more than ${MAX_REDIRECTS} redirects`)
    const next = URL.canParse(location, url) ? new URL(location, url).href : ''
    if (!isHttps(next)) throw new Error('redirected off https')
    if (!isArtworkOriginAllowed(next)) throw new Error(`redirected to an origin that isn't allowed (${new URL(next).hostname})`)
    url = next
    response = await fetchImpl(url, { signal, redirect: 'manual' })
  }
  return readArtworkBody(response)
}

export async function readArtworkBody(response: Response): Promise<Buffer> {
  const issue = !response.ok ? `HTTP ${response.status}` : Number(response.headers.get('content-length')) > MAX_BYTES ? 'larger than 15 MB' : null
  if (issue) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error(issue)
  }
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of response.body ?? []) {
    total += chunk.byteLength
    // Leaving the loop by throwing cancels the rest of the body.
    if (total > MAX_BYTES) throw new Error('larger than 15 MB')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export async function loadSharp(load: () => Promise<typeof import('sharp')> = () => import('sharp')) {
  try { return (await load()).default }
  catch (error) { throw new Error(`The image library sharp did not load (${error instanceof Error ? error.message : String(error)}). Run \`bun install\` in the ba-events checkout.`) }
}

export async function rasterJpeg(sharp: Awaited<ReturnType<typeof loadSharp>>, bytes: Buffer) {
  // Raster flyers only: an SVG could pull in other files while it renders.
  const { format } = await sharp(bytes, { limitInputPixels: MAX_PIXELS }).metadata()
  if (!format || !FORMATS.includes(format)) throw new Error(`not a JPEG, PNG, WebP, GIF, or AVIF image (${format ?? 'unknown'})`)
  return sharp(bytes, { failOn: 'error', limitInputPixels: MAX_PIXELS }).rotate()
    .resize({ width: LONG_SIDE, height: LONG_SIDE, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#1d1d23' }).jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true })
}

export async function fetchArtwork(events: Array<Pick<PostEvent, 'id' | 'title' | 'imageUrl'>>, dir: string, log: (message: string) => void, fetchImpl: typeof fetch = fetch): Promise<Artwork> {
  const sharp = await loadSharp()
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  sharp.cache(false)
  sharp.concurrency(1)
  const artwork: Artwork = {}
  for (const [index, event] of events.entries()) {
    if (!event.imageUrl) { log(`artwork: ${event.id} (${event.title}) has no image; using the no-flyer card`); continue }
    try {
      const { data, info } = await rasterJpeg(sharp, await downloadArtwork(event.imageUrl, fetchImpl))
      if (Math.min(info.width, info.height) < MIN_SIDE) throw new Error(`only ${info.width} × ${info.height} px`)
      // Every channel is scaled to 45%, so even a white or saturated flyer leaves a dark ground.
      // It can be stretched over a whole 1080 × 1920 frame, so it is saved without chroma subsampling.
      const backdrop = await sharp(data).resize({ width: 384, height: 384, fit: 'inside' }).blur(14)
        .modulate({ saturation: 0.85 }).linear(0.45, 0).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer()
      const art: Art = { file: join(dir, `art-${index + 1}.jpg`), backdrop: join(dir, `art-${index + 1}-bg.jpg`), width: info.width, height: info.height }
      writeFileSync(art.file, data)
      writeFileSync(art.backdrop, backdrop)
      artwork[event.id] = art
    } catch (error) {
      log(`artwork: ${event.id} (${event.title}) failed (${error instanceof Error ? error.message : String(error)}); using the no-flyer card`)
    }
  }
  return artwork
}
