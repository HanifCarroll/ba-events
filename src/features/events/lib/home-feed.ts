import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { BA_TIMEZONE } from '#shared/lib/constants.ts'
import type { ChatEventPayload } from '#shared/lib/types.ts'
import { normalizeText } from '#shared/lib/utils/normalize-text.ts'

/** Public shape of the compact compatibility feed. */
export type HomeEventCard = Pick<ChatEventPayload,
  'id' | 'name' | 'starts_at' | 'time_tba' | 'image_url' | 'image_width' | 'image_height' |
  'venue_name' | 'venue_neighborhood' | 'price' | 'is_free'>

export type HomeAgendaEvent = HomeEventCard & {
  image_url: string
  ends_at: string | null
  doors_at?: string | null
  venue_id: string | null
  is_all_day: boolean
  location_hidden: boolean
  location_tba: boolean
  music: boolean
  payWhatYouCan: boolean
  sourceUrl: string | null
}

export const HOME_FILTERS = ['hoy', 'finde', 'gratis', 'musica'] as const
export type HomeFilter = (typeof HOME_FILTERS)[number]
export const HOME_FALLBACK_LIMIT = 4
export const HOME_PAGE_SIZE = 24
export const HOME_EVENT_DEFAULT_DURATION_MS = 3 * 60 * 60 * 1000
// The catalog's date-only night ends at 04:00 Buenos Aires time (28 hours from local midnight).
export const HOME_DOORS_ONLY_DURATION_MS = 28 * 60 * 60 * 1000
export const HOME_FEED_FRESH_SECONDS = 60
export const HOME_FEED_STALE_SECONDS = 300
export const HOME_FEED_HEADERS = {
  // Explicit no-cache prevents the zone's minimum browser TTL from extending freshness.
  'Cache-Control': 'no-cache',
  'CDN-Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
  'Cloudflare-CDN-Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
}

export function parseHomeFilter(value: string | null): HomeFilter | null {
  return HOME_FILTERS.find((filter) => filter === value) ?? null
}

export const homeDay = (time: Date | string) => formatInTimeZone(time, BA_TIMEZONE, 'yyyy-MM-dd')

/** A current listing that began on an earlier date belongs under Today, without changing its stored start. */
export function agendaDisplayDay(event: Pick<HomeAgendaEvent, 'starts_at'>, today: string | undefined): string {
  const startDay = homeDay(event.starts_at)
  return today && startDay < today ? today : startDay
}

export function homeWindow(now: Date) {
  const day = homeDay(now)
  const date = new Date(`${day}T00:00:00Z`)
  const friday = date.getUTCDay() === 0 ? -2 : 5 - date.getUTCDay()
  const midnight = (offset: number) => {
    const shifted = new Date(date)
    shifted.setUTCDate(date.getUTCDate() + offset)
    return fromZonedTime(`${shifted.toISOString().slice(0, 10)}T00:00:00`, BA_TIMEZONE).toISOString()
  }
  return { day, start: midnight(0), tomorrow: midnight(1), end: midnight(7), weekendStart: midnight(friday), weekendEnd: midnight(friday + 3) }
}

export type HomeWindow = ReturnType<typeof homeWindow>
export type HomeAgenda = { window: HomeWindow; events: HomeAgendaEvent[]; asOf: number }
export type HomeAgendaCardEvent = HomeAgendaEvent & { slotStarts?: string[] }
export type HomeView = { events: HomeAgendaCardEvent[]; empty: HomeFilter | 'feed' | null }
export type HomeViewPage = HomeView & { total: number }
export type HomeAgendaPage = { view: HomeViewPage; flyers: HomeAgendaCardEvent[]; refreshInMs: number; day: string }

export function pageHomeView(view: HomeView, requested: string | null): HomeViewPage {
  const n = requested && /^\d+$/.test(requested) ? Number(requested) : 0
  const pages = Number.isSafeInteger(n) ? Math.floor(n / HOME_PAGE_SIZE) : 0
  const total = view.events.length
  const count = Math.min(total, Math.max(1, pages) * HOME_PAGE_SIZE)
  return { ...view, events: view.events.slice(0, count), total }
}

type OccurrenceTimes = Pick<HomeAgendaEvent, 'starts_at' | 'ends_at' | 'doors_at' | 'is_all_day' | 'time_tba'>

export function occurrenceEnd(event: OccurrenceTimes): number {
  const explicitEnd = event.ends_at ? Date.parse(event.ends_at) : NaN
  const start = Date.parse(event.starts_at)
  if (event.is_all_day || event.time_tba) {
    const midnight = Date.parse(homeWindow(new Date(start)).tomorrow)
    const cutoff = event.time_tba && event.doors_at ? start + HOME_DOORS_ONLY_DURATION_MS : midnight
    return Math.max(cutoff, explicitEnd || midnight)
  }
  return Number.isFinite(explicitEnd) ? explicitEnd : start + HOME_EVENT_DEFAULT_DURATION_MS
}

export function overlaps(event: HomeAgendaEvent, start: number, end: string): boolean {
  return event.starts_at < end && occurrenceEnd(event) > start
}

function currentWindow(agenda: HomeAgenda, now: number): HomeWindow {
  return now < Date.parse(agenda.window.tomorrow) ? agenda.window : homeWindow(new Date(now))
}

export function nextHomeViewChange(agenda: HomeAgenda, now: number): number {
  let next = Date.parse(currentWindow(agenda, now).tomorrow)
  for (const event of agenda.events) {
    const start = Date.parse(event.starts_at)
    const end = occurrenceEnd(event)
    if (start > now && start < next) next = start
    if (end > now && end < next) next = end
  }
  return next
}

export function groupOccurrences(events: HomeAgendaEvent[], now: number): HomeAgendaCardEvent[] {
  const groups = new Map<string, HomeAgendaEvent[]>()
  for (const event of events) {
    const title = normalizeText(event.name)
    const key = event.venue_id && title && !event.time_tba && !event.is_all_day
      ? JSON.stringify([event.venue_id, title, homeDay(event.starts_at)])
      : event.id
    const existing = groups.get(key)
    if (existing) existing.push(event)
    else groups.set(key, [event])
  }
  return [...groups.values()].map((group): HomeAgendaCardEvent => {
    if (group.length === 1) return group[0]
    const event = group.find((slot) => Date.parse(slot.starts_at) > now) ?? group[0]
    const slotStarts = [...new Set(group.map((slot) => slot.starts_at))]
    return { ...event, slotStarts }
  }).sort((a, b) => homeDay(a.starts_at).localeCompare(homeDay(b.starts_at)) ||
    (Date.parse(a.time_tba && a.doors_at || a.starts_at) - Date.parse(b.time_tba && b.doors_at || b.starts_at)))
}

export const isFreeAdmission = (event: HomeAgendaEvent) => !event.payWhatYouCan && (event.is_free || event.price === 0)

export function selectHomeEvents<T extends HomeAgendaEvent>(agenda: { window: HomeWindow; events: T[]; asOf: number }, filter: HomeFilter | null, now = agenda.asOf): T[] {
  const window = currentWindow(agenda, now)
  const week = agenda.events.filter(event => event.starts_at < window.end && occurrenceEnd(event) > now)
  if (filter === 'hoy') return week.filter(event => overlaps(event, Date.parse(window.start), window.tomorrow))
  if (filter === 'finde') return week.filter(event => overlaps(event, Date.parse(window.weekendStart), window.weekendEnd))
  if (filter === 'gratis') return week.filter(isFreeAdmission)
  if (filter === 'musica') return week.filter(event => event.music)
  return week
}

export function selectHomeView(agenda: HomeAgenda, filter: HomeFilter | null, now = agenda.asOf): HomeView {
  const matches = selectHomeEvents(agenda, filter, now)
  if (matches.length) return { events: groupOccurrences(matches, now), empty: null }
  if (!filter || !agenda.events.length) return { events: [], empty: 'feed' }
  if (filter === 'hoy' || filter === 'finde') {
    const window = currentWindow(agenda, now)
    const end = filter === 'hoy' ? window.tomorrow : window.weekendEnd
    const later = agenda.events.filter(event => event.starts_at >= end && occurrenceEnd(event) > now)
    return { events: groupOccurrences(later, now).slice(0, HOME_FALLBACK_LIMIT), empty: filter }
  }
  return { events: [], empty: filter }
}

function flyerRank(day: string, id: string): number {
  let hash = 2166136261
  for (const char of `${day}:${id}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return hash >>> 0
}

export function selectHomeCollage(agenda: HomeAgenda, now = agenda.asOf): HomeAgendaCardEvent[] {
  const { day, weekendStart, weekendEnd } = currentWindow(agenda, now)
  const weekendStartMs = Date.parse(weekendStart)
  const candidates = selectHomeView(agenda, null, now).events.slice(5)
    .filter(event => event.image_url.trim())
    .map(event => {
      const { id, image_width: width, image_height: height } = event
      return {
        event,
        weekend: overlaps(event, weekendStartMs, weekendEnd),
        portrait: width != null && height != null && width > 0 && height > 0 && width / height <= 0.9,
        rank: flyerRank(day, id),
      }
    })
    .sort((a, b) => Number(b.portrait) - Number(a.portrait) || a.rank - b.rank)

  const selected: HomeAgendaCardEvent[] = []
  const venues = new Set<string>()
  function fill(weekendOnly: boolean) {
    for (const { event, weekend } of candidates) {
      if (selected.length === 4) break
      if (weekend !== weekendOnly || (event.venue_id && venues.has(event.venue_id))) continue
      selected.push(event)
      if (event.venue_id) venues.add(event.venue_id)
    }
  }
  fill(true)
  if (selected.length < 3) fill(false)
  return selected.length >= 3 ? selected : []
}

export function toCompactHomeCard(event: HomeAgendaEvent): HomeEventCard {
  const { id, name, starts_at, time_tba, image_url, image_width, image_height, venue_name, venue_neighborhood, price, is_free } = event
  return { id, name, starts_at, time_tba, image_url, image_width, image_height, venue_name, venue_neighborhood, price, is_free }
}
