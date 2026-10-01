import { fetchRevalidatedHtml } from '../../acquisition/http.ts'
import {
  extractJsonLd,
  extractNextData,
  getNestedValue,
} from '#shared/lib/html-parsing.ts'
import type { EventStatus } from '#shared/lib/types.ts'
import type { MeetupEvent, MeetupVenue } from './types.ts'

export interface MeetupDetail {
  description: string | null
  venue: MeetupVenue | null
  dateTime: string | null
  endTime: string | null
  status: EventStatus | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function firstString(object: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    if (typeof object[key] === 'string' && object[key].trim()) return object[key].trim()
  }
  return null
}

function firstNumber(object: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = object[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  }
  return null
}

function normalizeStatus(value: unknown): EventStatus | null {
  if (typeof value !== 'string') return null
  const status = value.toLowerCase().split(/[\/#]/).pop()?.replace(/[^a-z]/g, '') ?? ''
  const normalized = status.startsWith('event') ? status.slice('event'.length) : status
  if (normalized === 'cancelled' || normalized === 'canceled') return 'canceled'
  if (normalized === 'postponed') return 'postponed'
  if (normalized === 'past') return 'past'
  if (normalized === 'scheduled' || normalized === 'active' || normalized === 'confirmed') return 'scheduled'
  return null
}

function venueFromObject(value: unknown): MeetupVenue | null {
  const location = asRecord(value)
  if (!location) return null
  const name = firstString(location, ['name', 'venueName'])
  if (!name) return null
  const addressValue = location.address
  const address = typeof addressValue === 'string'
    ? addressValue
    : firstString(asRecord(addressValue) ?? {}, ['streetAddress', 'addressLocality', 'name'])
  const geo = asRecord(location.geo)
  return {
    name,
    address,
    city: firstString(location, ['city', 'addressLocality']) ?? firstString(asRecord(addressValue) ?? {}, ['addressLocality']),
    lat: firstNumber(location, ['lat', 'latitude']) ?? firstNumber(geo ?? {}, ['lat', 'latitude']),
    lng: firstNumber(location, ['lng', 'lon', 'longitude']) ?? firstNumber(geo ?? {}, ['lng', 'lon', 'longitude']),
  }
}

function isEventType(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(isEventType)
  return typeof value === 'string' && (value === 'Event' || value.endsWith('Event'))
}

function jsonLdEvent(html: string): Record<string, unknown> | null {
  for (const data of extractJsonLd(html)) {
    const graph = asRecord(data)?.['@graph']
    const candidates = [data, ...(Array.isArray(graph) ? graph : [])]
    const event = candidates.find((candidate) => isEventType(asRecord(candidate)?.['@type']))
    if (event) return asRecord(event)
  }
  return null
}

function detailFromEvent(event: Record<string, unknown>): MeetupDetail {
  const venue = venueFromObject(event.venue) ?? venueFromObject(event.location)
  return {
    description: firstString(event, ['description']),
    venue,
    dateTime: firstString(event, ['dateTime', 'startDate', 'startTime']),
    endTime: firstString(event, ['endTime', 'endDate']),
    status: normalizeStatus(event.status ?? event.eventStatus),
  }
}

export function extractMeetupDetailFromHtml(html: string): MeetupDetail {
  const nextEvent = asRecord(getNestedValue(extractNextData(html), 'props.pageProps.event'))
  if (nextEvent) {
    const detail = detailFromEvent(nextEvent)
    const jsonLd = jsonLdEvent(html)
    const fallback = jsonLd ? detailFromEvent(jsonLd) : null
    return {
      description: detail.description ?? fallback?.description ?? null,
      venue: detail.venue ?? fallback?.venue ?? null,
      dateTime: detail.dateTime ?? fallback?.dateTime ?? null,
      endTime: detail.endTime ?? fallback?.endTime ?? null,
      status: detail.status ?? fallback?.status ?? null,
    }
  }

  const event = jsonLdEvent(html)
  return event ? detailFromEvent(event) : { description: null, venue: null, dateTime: null, endTime: null, status: null }
}

export async function fetchMeetupEventDetail(eventUrl: string): Promise<MeetupDetail | null> {
  const fullUrl = eventUrl.startsWith('http')
    ? eventUrl
    : `https://www.meetup.com${eventUrl.startsWith('/') ? '' : '/'}${eventUrl}`
  const html = await fetchRevalidatedHtml(fullUrl)
  return html ? extractMeetupDetailFromHtml(html) : null
}

export function mergeMeetupDetail(event: MeetupEvent, detail: MeetupDetail): void {
  if (detail.description) event.description = detail.description
  if (detail.venue) event.venue = detail.venue
  if (detail.dateTime) event.dateTime = detail.dateTime
  if (detail.endTime) event.endTime = detail.endTime
  if (detail.status) event.status = detail.status
}

export async function enrichMeetupEventsWithDetails(
  events: MeetupEvent[],
  concurrency = 5,
  delayMs = 500
): Promise<void> {
  for (let i = 0; i < events.length; i += concurrency) {
    await Promise.all(events.slice(i, i + concurrency).map(async (event) => {
      try {
        const detail = await fetchMeetupEventDetail(event.eventUrl)
        if (detail) mergeMeetupDetail(event, detail)
      } catch {
        // Preserve list data when the detail page is unavailable.
      }
    }))
    if (i + concurrency < events.length) await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
}
