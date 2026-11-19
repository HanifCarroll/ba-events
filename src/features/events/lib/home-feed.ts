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
export const HOME_EVENT_DEFAULT_DURATION_MS = 3 * 60 * 60 * 1000
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

const localDay = (time: Date | string) => formatInTimeZone(time, BA_TIMEZONE, 'yyyy-MM-dd')

export function homeWindow(now: Date) {
  const day = localDay(now)
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

function occurrenceEnd(event: HomeAgendaEvent): number {
  const explicitEnd = event.ends_at ? Date.parse(event.ends_at) : NaN
  const start = Date.parse(event.starts_at)
  if (event.is_all_day || event.time_tba) {
    const midnight = Date.parse(homeWindow(new Date(start)).tomorrow)
    return Math.max(midnight, explicitEnd || midnight)
  }
  return Number.isFinite(explicitEnd) ? explicitEnd : start + HOME_EVENT_DEFAULT_DURATION_MS
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

function groupOccurrences(events: HomeAgendaEvent[], now: number): HomeAgendaCardEvent[] {
  const groups = new Map<string, HomeAgendaEvent[]>()
  for (const event of events) {
    const title = normalizeText(event.name)
    const key = event.venue_id && title && !event.time_tba && !event.is_all_day
      ? JSON.stringify([event.venue_id, title, localDay(event.starts_at)])
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
  }).sort((a, b) => a.starts_at.localeCompare(b.starts_at))
}

export function selectHomeView(agenda: HomeAgenda, filter: HomeFilter | null, now = agenda.asOf): HomeView {
  const window = currentWindow(agenda, now)
  const remaining = agenda.events.filter((event) => occurrenceEnd(event) > now)
  const week = remaining.filter((event) => event.starts_at < window.end)
  if (!filter) return { events: groupOccurrences(week, now), empty: week.length ? null : 'feed' }
  if (!agenda.events.length) return { events: [], empty: 'feed' }

  if (filter === 'hoy' || filter === 'finde') {
    const start = Date.parse(filter === 'hoy' ? window.start : window.weekendStart)
    const end = filter === 'hoy' ? window.tomorrow : window.weekendEnd
    const matches = week.filter((event) => event.starts_at < end && occurrenceEnd(event) > start)
    return matches.length
      ? { events: groupOccurrences(matches, now), empty: null }
      : { events: groupOccurrences(remaining.filter((event) => event.starts_at >= end), now).slice(0, HOME_FALLBACK_LIMIT), empty: filter }
  }

  const matches = week.filter((event) => filter === 'gratis'
    ? !event.payWhatYouCan && (event.is_free || event.price === 0)
    : event.music)
  return { events: groupOccurrences(matches, now), empty: matches.length ? null : filter }
}

export function toCompactHomeCard(event: HomeAgendaEvent): HomeEventCard {
  const { id, name, starts_at, time_tba, image_url, image_width, image_height, venue_name, venue_neighborhood, price, is_free } = event
  return { id, name, starts_at, time_tba, image_url, image_width, image_height, venue_name, venue_neighborhood, price, is_free }
}
