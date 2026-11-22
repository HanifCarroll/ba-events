import { describe, expect, it } from 'vitest'
import type { EventWithVenue } from '#shared/lib/types.ts'
import { createGetDirectionsTool } from './get-directions.ts'
import { ensureChatEventPayload, formatEventForClaude, formatEventDetailsForClaude, formatSavedEventsForClaude } from './utils.ts'

const event = {
  id: 'event', name: 'Source event', status: 'scheduled',
  venue_id: 'venue', venue_name: 'Source venue', venue_neighborhood: 'Palermo',
  venue_address: 'Private street 123', location_hidden: false, location_tba: false,
  starts_at: '2026-10-14T01:00:00.000Z', ends_at: null, time_tba: false,
  price: null, is_free: false, embedding: [1],
  description_es: null, description_en: null,
} as unknown as EventWithVenue
const context = { userContext: { userId: null, isAuthenticated: false }, locale: 'en' as const }

describe('concierge source presentation', () => {
  it('preserves known prices and missing source facts without inventing descriptions or links', () => {
    for (const [price, is_free, expected] of [
      [null, false, 'TBA'], [0, false, 'Free'], [1500, false, '$1500 ARS'], [null, true, 'Free'],
    ] as const) {
      const source = { ...event, price, is_free, link: null, ticket_url: null, categories: ['music'],
        description_unavailable: true, description_display_en: null, description_display_es: null,
        description_summary_en: null, description_summary_es: null }
      expect(formatEventForClaude(source)).toMatchObject({ price: expected, description: null, ticketUrl: null })
      expect(formatEventDetailsForClaude(source)).toMatchObject({ price: expected, description: null, ticketUrl: null, link: null })
      expect(formatSavedEventsForClaude([source])[0].price).toBe(expected)
      expect(ensureChatEventPayload(source)).toMatchObject({ price, is_free, link: null, ticket_url: null })
    }
  })

  it('tells the model when doors open without turning that time into the start', () => {
    const source = { ...event, time_tba: true, doors_at: '2026-10-14T01:00:00.000Z' }
    const expected = { dateTime: 'Doors open Tuesday, Oct 13 at 10:00 PM', timeTba: true }
    expect(formatEventForClaude(source)).toMatchObject(expected)
    expect(formatEventDetailsForClaude(source)).toMatchObject(expected)
    expect(formatSavedEventsForClaude([source])[0]).toMatchObject(expected)
    expect(formatEventForClaude({ ...source, doors_at: null }).dateTime).toBe('Time TBA')
    expect(formatEventForClaude({ ...source, time_tba: false }).dateTime).toBe('Tuesday, Oct 13 at 10:00 PM')
  })

  for (const flag of ['location_hidden', 'location_tba'] as const) {
    it(`omits the address and rejects event directions for ${flag}`, async () => {
      const source = { ...event, [flag]: true }
      expect(ensureChatEventPayload(source)).toMatchObject({ venue_address: null })
      expect(ensureChatEventPayload(source)).not.toHaveProperty('embedding')
      expect(formatEventForClaude(source).venueAddress).toBeNull()
      expect(formatEventDetailsForClaude(source).venueAddress).toBeNull()
      let venueReads = 0
      const tool = createGetDirectionsTool({
        getEventWithVenue: async () => source,
        getVenueById: async () => { venueReads++; throw new Error('Unexpected venue fallback') },
      })
      const result = await tool.execute({ eventId: source.id, venueId: source.venue_id! }, context)
      expect(result).toMatchObject({ success: false, error: 'location_unavailable' })
      expect(result).not.toHaveProperty('directions')
      expect(JSON.stringify(result)).not.toContain(source.venue_address)
      expect(venueReads).toBe(0)
    })
  }

  it('keeps verified public addresses and source-based directions', async () => {
    const tool = createGetDirectionsTool({
      getEventWithVenue: async () => event,
      getVenueById: async () => { throw new Error('Unexpected venue fallback') },
    })
    expect(ensureChatEventPayload(event).venue_address).toBe(event.venue_address)
    const result = await tool.execute({ eventId: event.id }, context)
    expect(result).toMatchObject({ success: true, directions: {
      address: 'Private street 123, Palermo', eventId: event.id, venueId: event.venue_id,
      mapsUrl: 'https://www.google.com/maps/dir/?api=1&destination=Source%20venue%2C%20Private%20street%20123%2C%20Palermo%2C%20Buenos%20Aires%2C%20Argentina',
    } })
  })
})
