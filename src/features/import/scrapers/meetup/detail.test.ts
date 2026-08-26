import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchMeetupEventDetail, mergeMeetupDetail, extractMeetupDetailFromHtml } from './detail.ts'
import { transformMeetupEvent } from './transformer.ts'
import type { MeetupEvent } from './types.ts'

afterEach(() => vi.unstubAllGlobals())

const event: MeetupEvent = {
  id: '123',
  name: 'Talk',
  description: null,
  dateTime: '2026-08-26T10:00:00-03:00',
  endTime: null,
  timezone: 'America/Argentina/Buenos_Aires',
  eventUrl: 'https://www.meetup.com/group/events/123',
  imageUrl: null,
  venue: null,
  isOnline: false,
  status: 'scheduled',
  group: { name: 'Group', urlname: 'group', rating: null },
  attendeeCount: 0,
  category: null,
  isRecurring: false,
  recurrencePattern: null,
  price: null,
  currency: null,
}

describe('Meetup detail extraction', () => {
  it('fetches one detail page for description and EducationEvent venue data', async () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { event: {
        description: 'Full source description',
        venue: { name: 'Casa Uno', address: 'Calle 1', latitude: -34.6, longitude: -58.4 },
      } } },
    })}</script><script type="application/ld+json">${JSON.stringify({
      '@type': 'EducationEvent',
      location: { '@type': 'Place', name: 'Fallback Place' },
    })}</script>`
    const fetchMock = vi.fn().mockResolvedValue(new Response(html))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchMeetupEventDetail(event.eventUrl)).resolves.toMatchObject({
      description: 'Full source description',
      venue: { name: 'Casa Uno', address: 'Calle 1', lat: -34.6, lng: -58.4 },
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('applies detail description, times, and status while preserving absent fields', () => {
    mergeMeetupDetail(event, {
      description: 'Updated description',
      venue: { name: 'Venue', address: null, city: null, lat: null, lng: null },
      dateTime: '2026-08-26T11:00:00-03:00',
      endTime: '2026-08-26T13:00:00-03:00',
      status: 'canceled',
    })

    const transformed = transformMeetupEvent(event, null)
    expect(transformed).toMatchObject({
      description_en: 'Updated description',
      starts_at: '2026-08-26T14:00:00.000Z',
      ends_at: '2026-08-26T16:00:00.000Z',
      status: 'canceled',
    })

    const originalDescription = event.description
    mergeMeetupDetail(event, { description: null, venue: null, dateTime: null, endTime: null, status: null })
    expect(event.description).toBe(originalDescription)
  })

  it('accepts an EducationEvent JSON-LD fallback', () => {
    expect(extractMeetupDetailFromHtml(`<script type="application/ld+json">${JSON.stringify({
      '@type': 'EducationEvent',
      description: 'JSON-LD description',
      startDate: '2026-08-26T11:00:00-03:00',
      location: { '@type': 'Place', name: 'School', address: 'Street 2' },
    })}</script>`)).toMatchObject({
      description: 'JSON-LD description',
      dateTime: '2026-08-26T11:00:00-03:00',
      venue: { name: 'School', address: 'Street 2' },
    })
  })

  it('handles Schema.org status URLs and malformed graphs safely', () => {
    expect(extractMeetupDetailFromHtml(`<script id="__NEXT_DATA__">${JSON.stringify({
      props: { pageProps: { event: { eventStatus: 'https://schema.org/EventScheduled' } } },
    })}</script>`).status).toBe('scheduled')
    expect(extractMeetupDetailFromHtml(`<script id="__NEXT_DATA__">${JSON.stringify({
      props: { pageProps: { event: { eventStatus: 'https://schema.org/EventCanceled' } } },
    })}</script>`).status).toBe('canceled')
    expect(extractMeetupDetailFromHtml(`<script type="application/ld+json">${JSON.stringify({
      '@type': 'Event',
      '@graph': { malformed: true },
    })}</script>`)).toEqual({
      description: null,
      venue: null,
      dateTime: null,
      endTime: null,
      status: null,
    })
  })
})
