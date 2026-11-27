/** Which catalog events a post shows (brief "Selection"). Pure: the D1 read lives in runtime.ts. */
import { isExternalArtworkOriginAllowed } from '#shared/lib/artwork-origins.ts'
import { decodeArtworkRef, type ArtworkRef } from '#shared/lib/artwork-ref.ts'
import { isArtworkEventId } from '#shared/lib/artwork-url.ts'
import { baLocal, descriptionLine, displayTitle, priceLabel, timeLabel } from './format.ts'
import { FORMATS, type FormatKey, type FormatSpec, type RunWindow } from './formats.ts'

/** One row of the read-only catalog query: an intake-backed event with its venue. */
export interface CatalogEvent {
  id: string
  name: string
  startsAt: string
  endsAt: string | null
  price: number | null
  isFree: boolean
  payWhatYouWant: boolean
  status: string
  timeTba: boolean
  isAllDay: boolean
  categories: string[]
  summary: string | null
  /** The catalog's raw `image_url` value. */
  imageUrl: string | null
  venue: string | null
  barrio: string | null
  venueHandle: string | null
  sourceAccount: string | null
  /** True when an intake candidate (not a link to a scraped event) left the time unknown. */
  intakeTimeUnknown: boolean
}

/** What a card or caption line needs, already formatted. */
export interface PostEvent {
  id: string
  date: string
  startsAt: string
  title: string
  time: string
  description: string | null
  venue: string
  barrio: string
  price: string | null
  handle: string | null
  artworkRef: ArtworkRef | null
  /** True when the handle is the posting account, not the venue's own ("Vía @handle"). */
  via: boolean
}

/**
 * Placeholder starts the catalog uses for "time unknown": 23:59 (the intake's end-of-day stand-in, seconds and all) and
 * 00:00 when an intake candidate left the time empty. Time-TBA rows are 00:00 too, and `timeTba` already covers them.
 */
export function placeholderTime(event: CatalogEvent): boolean {
  const { hour, minute } = baLocal(event.startsAt)
  return (hour === 23 && minute === 59) || (hour === 0 && minute === 0 && event.intakeTimeUnknown)
}

const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/**
 * Whether a posting account is the venue's own, judged by name: "salalucida" is Sala Lúcida, "ccmacedonia" is Centro
 * Cultural Macedonia, "bibliotecacafemusica" is La Biblioteca Café. "vamos_gratis" at Facultad de Derecho is not.
 */
export function accountIsVenue(handle: string, venue: string): boolean {
  const account = normalize(handle).replace(/^cc/, 'centrocultural')
  const names = [normalize(venue), normalize(venue).replace(/^(la|el|los|las)(?=.{4})/, '')]
  return names.some(name => name.length >= 4 && (account.includes(name) || (account.length >= 4 && name.includes(account))))
}

/** Drop a trailing "@ {venue}" from a title when it names the event's own venue. */
export function stripVenueSuffix(title: string, venue: string): string {
  const match = /^(.*?\S)\s*@\s*([^@]+)$/u.exec(title)
  return match && normalize(match[2]!) === normalize(venue) ? match[1]!.trim() : title
}

export function qualifies(event: CatalogEvent, format: FormatKey, window: RunWindow): boolean {
  const spec = FORMATS[format]
  if (event.status !== 'scheduled' || event.timeTba || event.isAllDay || !event.venue || !event.barrio) return false
  if (placeholderTime(event)) return false
  // Over by the time the post goes out (no end time: by its start). A Reel may publish until its deadline, so its
  // events must still be running or upcoming then, or the pre-publish check would hold it.
  const over = Date.parse(event.endsAt ?? event.startsAt)
  if (format === 'reel' ? over <= window.deadline.getTime() : over < window.publishAt.getTime()) return false
  if (spec.freeOnly && !event.isFree) return false
  const local = baLocal(event.startsAt)
  if (local.date < window.from || local.date > window.to) return false
  return spec.fromHour === null || local.hour >= spec.fromHour
}

export function toPostEvent(event: CatalogEvent): PostEvent {
  const venue = event.venue!.replace(/[\s—–-]+$/u, '')
  const venueHandle = event.venueHandle?.trim().replace(/^@/, '') || null
  const handle = venueHandle || event.sourceAccount || null
  return {
    id: event.id,
    date: baLocal(event.startsAt).date,
    startsAt: event.startsAt,
    title: displayTitle(stripVenueSuffix(event.name, venue)),
    time: timeLabel(event.startsAt, event.endsAt),
    description: descriptionLine(event.summary),
    venue,
    barrio: event.barrio!,
    price: priceLabel(event),
    handle,
    artworkRef: publisherArtworkRef(event),
    via: handle !== null && handle !== venueHandle && !accountIsVenue(handle, venue),
  }
}

const venueKey = (event: CatalogEvent) => normalize(event.venue!)

/**
 * One event per venue, including a free event when the format wants one. Multi-day picks cover as many local dates
 * as possible under those constraints. Among candidates that preserve coverage, prefer artwork, then score variety
 * and a description line. Break ties by start time and ID, and list the result in that same order.
 */
export function selectEvents(events: CatalogEvent[], format: FormatKey, window: RunWindow, exclude: readonly string[] = []): PostEvent[] {
  const spec = FORMATS[format]
  const qualifying = events
    .filter(event => !exclude.includes(event.id) && qualifies(event, format, window))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id))
  return pick(qualifying, spec).map(toPostEvent)
}

function publisherArtworkRef(event: CatalogEvent): ArtworkRef | null {
  const reference = decodeArtworkRef(event.imageUrl?.trim(), event.id)
  if (!reference) return null
  const allowed = reference.kind === 'stored' ? isArtworkEventId(event.id) : isExternalArtworkOriginAllowed(reference.url)
  return allowed ? reference : null
}

function pick(pool: CatalogEvent[], spec: FormatSpec): CatalogEvent[] {
  const candidates = pool.map(event => ({ event, date: baLocal(event.startsAt).date, venue: venueKey(event), artwork: publisherArtworkRef(event) !== null }))
  const venuesByDate = new Map<string, Set<string>>()
  if (spec.days > 1) for (const { date, venue } of candidates) {
    if (!venuesByDate.has(date)) venuesByDate.set(date, new Set())
    venuesByDate.get(date)!.add(venue)
  }
  const picked: CatalogEvent[] = []
  const dates = new Set<string>()
  const venues = new Set<string>()
  const barrios = new Set<string>()
  const categories = new Set<string>()
  type Candidate = typeof candidates[number]
  const take = ({ event, date, venue }: Candidate) => {
    picked.push(event)
    dates.add(date)
    venues.add(venue)
    barrios.add(event.barrio!)
    for (const category of event.categories) categories.add(category)
  }
  // Match uncovered dates to distinct, unused venues. Reassign a venue's date if that frees another date to use it.
  const remainingCoverage = (after?: Candidate) => {
    const open = spec.max - picked.length - (after ? 1 : 0)
    const matched = new Map<string, string>()
    const match = (date: string, seen: Set<string>): boolean => {
      for (const venue of venuesByDate.get(date)!) {
        if (venues.has(venue) || venue === after?.venue || seen.has(venue)) continue
        seen.add(venue)
        const prior = matched.get(venue)
        if (prior && !match(prior, seen)) continue
        matched.set(venue, date)
        return true
      }
      return false
    }
    for (const date of venuesByDate.keys()) {
      if (matched.size >= open) break
      if (!dates.has(date) && date !== after?.date) match(date, new Set())
    }
    return matched.size
  }
  // Artwork outweighs the other preferences together (at most 9).
  const score = ({ event, artwork }: Candidate) =>
    (artwork ? 16 : 0)
    + (barrios.has(event.barrio!) ? 0 : 4)
    + (event.categories.some(category => !categories.has(category)) ? 2 : 0)
    + (descriptionLine(event.summary) ? 3 : 0)
  const ranked = (available: Candidate[]) => available.sort((a, b) => score(b) - score(a))
  if (spec.wantsFree) {
    let best: Candidate | undefined
    let bestCoverage = -1
    const target = Math.min(spec.max, venuesByDate.size)
    for (const candidate of ranked(candidates.filter(({ event }) => event.isFree))) {
      const coverage = spec.days > 1 ? 1 + remainingCoverage(candidate) : 0
      if (coverage > bestCoverage) {
        best = candidate
        bestCoverage = coverage
      }
      if (coverage >= target) break
    }
    if (best) take(best)
  }
  while (picked.length < spec.max) {
    const missing = remainingCoverage()
    // A pick on a covered date is fine if the remaining slots and venues can still cover the missing dates.
    const best = ranked(candidates.filter(({ venue }) => !venues.has(venue)))
      .find(candidate => !missing || remainingCoverage(candidate) + Number(!dates.has(candidate.date)) >= missing)
    if (!best) break
    take(best)
  }
  return picked.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id))
}
