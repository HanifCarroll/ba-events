/**
 * Each event's flyer, downloaded and prepared before a render: https only (redirects too, at most three), 10 s for the
 * whole download, at most 15 MB, and it must decode as an image. A flyer that fails leaves its event without artwork
 * (it gets the no-flyer card) and is logged. Only a broken setup throws: no `sharp`, or a directory that can't be made.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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

/** Redirects are followed by hand, so every hop is checked before it is requested. One timeout covers the whole chain. */
async function download(url: string, fetchImpl: typeof fetch): Promise<Buffer> {
  if (!isHttps(url)) throw new Error('not an https URL')
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  let response = await fetchImpl(url, { signal, redirect: 'manual' })
  // A response we stop reading is cancelled, so its connection isn't left open.
  const reject = async (why: string): Promise<never> => { await response.body?.cancel().catch(() => undefined); throw new Error(why) }
  for (let hops = 0; response.status >= 300 && response.status < 400; hops++) {
    const location = response.headers.get('location')
    if (!location) return reject(`HTTP ${response.status} without a Location`)
    if (hops === MAX_REDIRECTS) return reject(`more than ${MAX_REDIRECTS} redirects`)
    const next = URL.canParse(location, url) ? new URL(location, url).href : ''
    if (!isHttps(next)) return reject('redirected off https')
    await response.body?.cancel().catch(() => undefined)
    url = next
    response = await fetchImpl(url, { signal, redirect: 'manual' })
  }
  if (!response.ok) return reject(`HTTP ${response.status}`)
  if (Number(response.headers.get('content-length')) > MAX_BYTES) return reject('larger than 15 MB')
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
      const bytes = await download(event.imageUrl, fetchImpl)
      // Raster flyers only: an SVG could pull in other files while it renders.
      const { format } = await sharp(bytes, { limitInputPixels: MAX_PIXELS }).metadata()
      if (!format || !FORMATS.includes(format)) throw new Error(`not a JPEG, PNG, WebP, GIF, or AVIF image (${format ?? 'unknown'})`)
      const { data, info } = await sharp(bytes, { failOn: 'error', limitInputPixels: MAX_PIXELS }).rotate()
        .resize({ width: LONG_SIDE, height: LONG_SIDE, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#1d1d23' }).jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true })
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
