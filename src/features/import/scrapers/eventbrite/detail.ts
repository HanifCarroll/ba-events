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
  let response: Response
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': EVENTBRITE_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(20000),
      redirect: 'follow',
    })
  } catch {
    return null
  }
  if (!response.ok) return null

  const html = await response.text()

  const startRaw = html.match(/start_time" content="([^"]+)"/)?.[1] ?? null
  const endRaw = html.match(/end_time" content="([^"]+)"/)?.[1] ?? null

  const startsAt = startRaw ? toUtcIso(startRaw) : null
  let endsAt: string | null = null
  if (endRaw) {
    const end = toUtcIso(endRaw)
    if (end && startsAt && new Date(end).getTime() > new Date(startsAt).getTime()) {
      endsAt = end
    }
  }

  const price = extractPrice(html)
  const free = isFreeEvent(html)
  // "hasPrice" is true only when the page explicitly says free or lists a paid price;
  // a page with neither (no offersSchema, no badge) leaves the price unknown.
  const hasPrice = free || price !== null

  return {
    starts_at: startsAt,
    ends_at: endsAt,
    price,
    is_free: free,
    hasPrice,
    min_age: extractMinAge(html),
  }
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
