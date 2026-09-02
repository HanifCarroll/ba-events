/**
 * Eventbrite Detail Page Extractor
 *
 * The Eventbrite listing JSON-LD only exposes dates (YYYY-MM-DD), not times, prices,
 * or age restrictions. Those live on each event's detail page, which is why the fast
 * import path historically stored midnight-to-midnight events with is_free=true.
 *
 * This module fetches a detail page once and extracts, when available:
 *   - start/end times (from `start_time`/`end_time` meta tags)
 *   - price (from the offersSchema AggregateOffer JSON-LD)
 *   - minimum age (from the "Highlights_ageRestriction" span, e.g. "mayores de 18 años")
 *
 * All fields are best-effort: a missing/unparseable field yields null/undefined so the
 * caller keeps whatever the transformer defaulted to.
 */

import { Effect } from 'effect'

const EVENTBRITE_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

export interface EventbriteDetailInfo {
  /** ISO UTC start time from the detail page, or null if the page has no usable time */
  starts_at: string | null
  /** ISO UTC end time, or null when missing / date-only / not after start */
  ends_at: string | null
  /** Price in ARS, or null when the page does not expose one */
  price: number | null
  /** True when the page explicitly prices the event as free */
  is_free: boolean
  /** True when the page carries explicit price data (free badge or a paid price) */
  hasPrice: boolean
  /** Minimum age, or null when the page lists no age restriction */
  min_age: number | null
  /** Higher-fidelity image from the detail page JSON-LD, when present */
  image_url: string | null
  image_width: number | null
  image_height: number | null
}

/**
 * True when an ISO string carries a time-of-day component (not just a date).
 * The listing and some detail pages emit date-only values like "2026-08-13".
 */
function hasTimeComponent(iso: string): boolean {
  return /T\d{2}:\d{2}/.test(iso)
}

/**
 * Convert an Eventbrite timestamp to UTC ISO.
 * Detail-page meta values carry explicit offsets ("2026-08-13T20:00:00-03:00").
 * A few values are naive local times — treat those as Buenos Aires (UTC-3, no DST).
 */
function toUtcIso(value: string): string | null {
  if (!hasTimeComponent(value)) return null
  const withOffset = /[+-]\d{2}:\d{2}$|Z$/.test(value)
  const iso = withOffset ? value : `${value}-03:00`
  const date = new Date(iso)
  return isNaN(date.getTime()) ? null : date.toISOString()
}

/** Extract the detail-page JSON-LD image without fetching the page again. */
export function extractEventbriteDetailImage(html: string): {
  url: string | null
  width: number | null
  height: number | null
} {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  for (const match of scripts) {
    try {
      const value = JSON.parse(match[1].trim()) as unknown
      const roots = Array.isArray(value) ? value : [value]
      const nodes = roots.flatMap((root) => {
        if (!root || typeof root !== 'object') return []
        const graph = (root as { ['@graph']?: unknown })['@graph']
        return Array.isArray(graph) ? graph : [root]
      })
      for (const node of nodes) {
        if (!node || typeof node !== 'object') continue
        const event = node as { ['@type']?: string | string[]; image?: unknown }
        const type = event['@type']
        if (!(type === 'Event' || (Array.isArray(type) && type.includes('Event')))) continue
        const image = Array.isArray(event.image) ? event.image[0] : event.image
        const imageObject = typeof image === 'string' ? { url: image } : image
        if (!imageObject || typeof imageObject !== 'object') continue
        const record = imageObject as { url?: unknown; width?: unknown; height?: unknown }
        if (typeof record.url !== 'string' || !/^https?:\/\//.test(record.url)) continue
        return {
          url: record.url,
          width: toImageDimension(record.width) ?? dimensionFromUrl(record.url, 'w') ?? extractMetaDimension(html, 'og:image:width'),
          height: toImageDimension(record.height) ?? dimensionFromUrl(record.url, 'h') ?? extractMetaDimension(html, 'og:image:height'),
        }
      }
    } catch {
      // JSON-LD blocks can contain invalid fragments; try the next one.
    }
  }
  return { url: null, width: null, height: null }
}

function toImageDimension(value: unknown): number | null {
  const dimension = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isInteger(dimension) && dimension > 0 ? dimension : null
}

function dimensionFromUrl(url: string, key: 'w' | 'h'): number | null {
  try {
    return toImageDimension(new URL(url).searchParams.get(key))
  } catch {
    return null
  }
}

function extractMetaDimension(html: string, property: string): number | null {
  const match = html.match(new RegExp(`property=["']${property}["'][^>]+content=["'](\\d+)["']`, 'i'))
  return toImageDimension(match?.[1])
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/** Read dimensions from common image headers without decoding or storing the image. */
export function readImageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: readUint32(bytes, 16), height: readUint32(bytes, 20) }
  }
  if (bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { width: readUint16LittleEndian(bytes, 6), height: readUint16LittleEndian(bytes, 8) }
  }
  if (bytes.length >= 30 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x58) {
      return {
        width: 1 + readUint24LittleEndian(bytes, 24),
        height: 1 + readUint24LittleEndian(bytes, 27),
      }
    }
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let offset = 2; offset + 9 < bytes.length; ) {
      if (bytes[offset] !== 0xff) { offset++; continue }
      const marker = bytes[offset + 1]
      offset += 2
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue
      const length = readUint16(bytes, offset)
      if (length < 2 || offset + length > bytes.length) break
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { width: readUint16(bytes, offset + 5), height: readUint16(bytes, offset + 3) }
      }
      offset += length
    }
  }
  return null
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1]
}
function readUint16LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}
function readUint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}
function readUint32(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 0x1000000 + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]
}

class EventbriteDetailError extends Error {
  readonly _tag = 'EventbriteDetailError'
}

function measureImageEffect(url: string) {
  const program = Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(url, { headers: { 'User-Agent': EVENTBRITE_UA }, signal: AbortSignal.timeout(10000), redirect: 'follow' }),
      catch: (error) => new EventbriteDetailError(error instanceof Error ? error.message : String(error)),
    })
    if (!response.ok) return null
    const contentLength = Number(response.headers.get('content-length'))
    if (contentLength > MAX_IMAGE_BYTES) return null
    const bytes = yield* Effect.tryPromise({
      try: () => response.arrayBuffer(),
      catch: (error) => new EventbriteDetailError(error instanceof Error ? error.message : String(error)),
    })
    if (bytes.byteLength > MAX_IMAGE_BYTES) return null
    return readImageDimensions(new Uint8Array(bytes))
  })
  return Effect.match(program, {
    onFailure: () => null,
    onSuccess: (value) => value,
  })
}

async function measureImage(url: string): Promise<{ width: number; height: number } | null> {
  return Effect.runPromise(measureImageEffect(url))
}

/** Extract minimum age from page HTML. Returns null when no age restriction is present. */
function extractMinAge(html: string): number | null {
  // Eventbrite renders age restrictions as a "Highlights_ageRestriction" highlight
  // (e.g. "mayores de 18 años" / "Ages 18+"). This is the only reliable signal:
  // generic text patterns for "mayores de X años" also match Eventbrite's embedded
  // i18n translation dictionary ("Ages 12+":"Mayores de 12 años"), which is NOT the
  // event's real restriction.
  const highlight = html.match(/Highlights_ageRestriction[^>]*>\s*([^<]+?)\s*</)
  if (!highlight) return null
  const digits = highlight[1].match(/\d+/)
  if (!digits) return null
  const age = parseInt(digits[0], 10)
  return age > 0 && age < 120 ? age : null
}

/** Extract price (ARS) from page HTML. Returns null when the page exposes none. */
function extractPrice(html: string): number | null {
  // Paid events expose an AggregateOffer in JSON-LD
  const low = html.match(/"lowPrice":"([\d.]+)"/)?.[1]
  if (low !== undefined) {
    const price = parseFloat(low)
    if (!isNaN(price) && price > 0) return Math.round(price)
  }
  const price = html.match(/"price"\s*:\s*"?([\d.]+)"?/)?.[1]
  if (price !== undefined) {
    const p = parseFloat(price)
    if (!isNaN(p) && p > 0) return Math.round(p)
  }
  return null
}

/** True when the page marks the event as free. */
function isFreeEvent(html: string): boolean {
  return (
    html.includes('data-testid="free-badge"') ||
    html.includes('>Gratis<') ||
    html.includes('>Free<') ||
    html.includes('"price":"0"') ||
    html.includes('"price": "0"')
  )
}

/**
 * Fetch an Eventbrite detail page and extract time / price / min_age.
 * Returns null on network error or non-200 (caller decides how to handle).
 */
export async function fetchEventbriteDetail(url: string): Promise<EventbriteDetailInfo | null> {
  const program = Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(url, {
        headers: {
          'User-Agent': EVENTBRITE_UA,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
        },
        signal: AbortSignal.timeout(20000),
        redirect: 'follow',
      }),
      catch: (error) => new EventbriteDetailError(error instanceof Error ? error.message : String(error)),
    })
    if (!response.ok) return null
    const html = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (error) => new EventbriteDetailError(error instanceof Error ? error.message : String(error)),
    })

    const startRaw = html.match(/start_time" content="([^"]+)"/)?.[1] ?? null
    const endRaw = html.match(/end_time" content="([^"]+)"/)?.[1] ?? null
    const startsAt = startRaw ? toUtcIso(startRaw) : null
    let endsAt: string | null = null
    if (endRaw) {
      const end = toUtcIso(endRaw)
      if (end && startsAt && new Date(end).getTime() > new Date(startsAt).getTime()) endsAt = end
    }

    const price = extractPrice(html)
    const free = isFreeEvent(html)
    const image = extractEventbriteDetailImage(html)
    if (image.url && (!image.width || !image.height)) {
      const measured = yield* measureImageEffect(image.url)
      if (measured) {
        image.width ??= measured.width
        image.height ??= measured.height
      }
    }
    return {
      starts_at: startsAt,
      ends_at: endsAt,
      price,
      is_free: free,
      hasPrice: free || price !== null,
      min_age: extractMinAge(html),
      image_url: image.url,
      image_width: image.width,
      image_height: image.height,
    }
  })
  return Effect.runPromise(Effect.match(program, {
    onFailure: () => null,
    onSuccess: (value) => value,
  }))
}

export interface EventbriteDetailTarget {
  id: string
  url: string
}

export type EventbriteDetailMap = Map<string, EventbriteDetailInfo>

/**
 * Fetch detail pages for many events concurrently, with per-request retry.
 *
 * @param targets - external_id -> detail URL pairs
 * @param concurrency - max in-flight fetches (default 5)
 * @param retries - attempts per URL (default 2)
 * @returns Map of external_id -> detail (omits entries that could not be fetched)
 */
export async function fetchEventbriteDetailsBatch(
  targets: EventbriteDetailTarget[],
  concurrency: number = 5,
  retries: number = 2
): Promise<EventbriteDetailMap> {
  const results = new Map<string, EventbriteDetailInfo>()
  let idx = 0

  async function worker() {
    while (idx < targets.length) {
      const target = targets[idx++]
      for (let attempt = 0; attempt < retries; attempt++) {
        const detail = await fetchEventbriteDetail(target.url)
        if (detail) {
          results.set(target.id, detail)
          break
        }
        if (attempt < retries - 1) {
          await new Promise((r) => setTimeout(r, 800))
        }
      }
      // Small inter-request delay to be polite to Eventbrite
      await new Promise((r) => setTimeout(r, 200))
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker))
  return results
}
