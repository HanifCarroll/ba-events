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
}

export function qualifies(event: CatalogEvent, format: FormatKey, window: RunWindow): boolean {
  const spec = FORMATS[format]
  if (event.status !== 'scheduled' || event.timeTba || event.isAllDay || !event.venue || !event.barrio) return false
  if (spec.freeOnly && !event.isFree) return false
  const local = baLocal(event.startsAt)
  if (local.date < window.from || local.date > window.to) return false
  return spec.fromHour === null || local.hour >= spec.fromHour
}

export function toPostEvent(event: CatalogEvent): PostEvent {
  return {
    id: event.id,
    date: baLocal(event.startsAt).date,
    startsAt: event.startsAt,
    title: displayTitle(event.name),
    time: timeLabel(event.startsAt, event.endsAt),
    description: descriptionLine(event.summary),
    venue: event.venue!.replace(/[\s—–-]+$/u, ''),
    barrio: event.barrio!,
    price: priceLabel(event),
    handle: event.venueHandle?.trim().replace(/^@/, '') || event.sourceAccount || null,
  }
}

const venueKey = (event: CatalogEvent) => event.venue!.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

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
