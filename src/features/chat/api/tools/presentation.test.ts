import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { getEventFactsByIds } from '#shared/lib/db/client.server.ts'
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

  it('omits venue capabilities from hidden/TBA pinned and follow-up facts at the database boundary', async () => {
    let requested: URL | undefined
    const rows = [
      { id: 'hidden', name: 'Hidden event', venue_id: 'secret', venue_name: 'Venue', status: 'scheduled', location_hidden: true, location_tba: false },
      { id: 'tba', name: 'TBA event', venue_id: 'unverified', venue_name: 'Venue', status: 'scheduled', location_hidden: false, location_tba: true },
      { id: 'public', name: 'Public event', venue_id: 'known', venue_name: 'Venue', status: 'scheduled', location_hidden: false, location_tba: false },
    ]
    const client = createClient('https://database.example.test', 'test-only-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (url) => { requested = new URL(String(url)); return Response.json(rows) } },
    })
    const facts = await getEventFactsByIds(rows.map(row => row.id), undefined, client)
    expect(requested?.searchParams.get('select')).toContain('location_hidden,location_tba')
    expect(facts.map(fact => fact.venue_id)).toEqual([null, null, 'known'])
    expect(facts[0]).toEqual({ id: 'hidden', name: 'Hidden event', venue_id: null, venue_name: 'Venue', status: 'scheduled' })
  })
})
