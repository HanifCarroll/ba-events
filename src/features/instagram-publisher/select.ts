/** Which catalog events a post shows (brief "Selection"). Pure: the D1 read lives in runtime.ts. */
import { baLocal, descriptionLine, displayTitle, priceLabel, timeLabel } from './format.ts'
import { FORMATS, type FormatKey, type RunWindow } from './formats.ts'

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
  // Over by the time the post goes out (no end time: by its start).
  if (Date.parse(event.endsAt ?? event.startsAt) < window.publishAt.getTime()) return false
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
    via: handle !== null && handle !== venueHandle && !accountIsVenue(handle, venue),
  }
}

const venueKey = (event: CatalogEvent) => normalize(event.venue!)

/**
 * Greedy pick, deterministic: one event per venue; a free event first when the format wants one; then whichever
 * candidate adds the most variety (new barrio, new category) and has a description line, earliest start on ties.
 * The post lists the picks in start order.
 */
export function selectEvents(events: CatalogEvent[], format: FormatKey, window: RunWindow, exclude: readonly string[] = []): PostEvent[] {
  const spec = FORMATS[format]
  const pool = events
    .filter(event => !exclude.includes(event.id) && qualifies(event, format, window))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id))
  const picked: CatalogEvent[] = []
  const venues = new Set<string>()
  const barrios = new Set<string>()
  const categories = new Set<string>()
  const take = (event: CatalogEvent) => {
    picked.push(event)
    venues.add(venueKey(event))
    barrios.add(event.barrio!)
    for (const category of event.categories) categories.add(category)
  }
  const score = (event: CatalogEvent) =>
    (barrios.has(event.barrio!) ? 0 : 4)
    + (event.categories.some(category => !categories.has(category)) ? 2 : 0)
    + (descriptionLine(event.summary) ? 3 : 0)
  if (spec.wantsFree) {
    const free = pool.filter(event => event.isFree).sort((a, b) => score(b) - score(a))[0]
    if (free) take(free)
  }
  while (picked.length < spec.max) {
    let best: CatalogEvent | undefined
    for (const event of pool) {
      if (picked.includes(event) || venues.has(venueKey(event))) continue
      if (!best || score(event) > score(best)) best = event
    }
    if (!best) break
    take(best)
  }
  return picked.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id)).map(toPostEvent)
}
