import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { BA_TIMEZONE } from '#shared/lib/constants.ts'
import type { ChatEventPayload } from '#shared/lib/types.ts'

/** Public shape of the compact compatibility feed. */
export type HomeEventCard = Pick<ChatEventPayload,
  'id' | 'name' | 'starts_at' | 'time_tba' | 'image_url' | 'image_width' | 'image_height' |
  'venue_name' | 'venue_neighborhood' | 'price' | 'is_free'>

export type HomeAgendaEvent = HomeEventCard & {
  image_url: string
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

export function homeWindow(now: Date) {
  const day = formatInTimeZone(now, BA_TIMEZONE, 'yyyy-MM-dd')
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
export type HomeAgenda = { window: HomeWindow; events: HomeAgendaEvent[] }

export function selectHomeView({ window, events }: HomeAgenda, filter: HomeFilter | null) {
  const week = events.filter((event) => event.starts_at < window.end)
  if (!filter) return { events: week, empty: week.length ? null : 'feed' } as const
  if (!events.length) return { events: [], empty: 'feed' } as const

  if (filter === 'hoy' || filter === 'finde') {
    const start = filter === 'hoy' ? window.start : window.weekendStart
    const end = filter === 'hoy' ? window.tomorrow : window.weekendEnd
    const matches = week.filter((event) => event.starts_at >= start && event.starts_at < end)
    return matches.length
      ? { events: matches, empty: null }
      : { events: events.filter((event) => event.starts_at >= end).slice(0, HOME_FALLBACK_LIMIT), empty: filter }
  }

  const matches = week.filter((event) => filter === 'gratis'
    ? !event.payWhatYouCan && (event.is_free || event.price === 0)
    : event.music)
  return { events: matches, empty: matches.length ? null : filter }
}

export function toCompactHomeCard(event: HomeAgendaEvent): HomeEventCard {
  const { id, name, starts_at, time_tba, image_url, image_width, image_height, venue_name, venue_neighborhood, price, is_free } = event
  return { id, name, starts_at, time_tba, image_url, image_width, image_height, venue_name, venue_neighborhood, price, is_free }
}
