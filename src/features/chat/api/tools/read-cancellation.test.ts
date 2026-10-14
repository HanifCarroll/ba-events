import { describe, expect, it } from 'vitest'
import type { EventWithVenue, Venue } from '#shared/lib/types.ts'
import { createGetDirectionsTool } from './get-directions.ts'
import { createGetEventDetailsTool } from './get-event-details.ts'
import { createGetVenueDetailsTool } from './get-venue-details.ts'
import { ensureChatEventPayload } from './utils.ts'

const event = { id: 'event', name: 'Source event', status: 'scheduled',
  starts_at: '2026-10-14T20:00:00Z', venue_id: 'venue', venue_name: 'Source venue',
  venue_address: 'Source street 1', venue_neighborhood: 'Palermo',
  location_hidden: false, location_tba: false, time_tba: false, price: null, is_free: false,
} as EventWithVenue
const venue = { id: 'venue', name: 'Source venue', address: 'Source street 1', neighborhood: 'Palermo' } as Venue
const base = { userContext: { userId: null, isAuthenticated: false }, locale: 'en' as const }
type Read = (signal?: AbortSignal) => Promise<void>
const cases = [
  { name: 'event details', make: (read: Read) => (signal: AbortSignal) => createGetEventDetailsTool(async (_id, current) => {
    await read(current); return { success: true, event: ensureChatEventPayload(event) }
  }).execute({ eventId: 'event' }, { ...base, abortSignal: signal }) },
  ...(['event', 'venue'] as const).map(kind => ({ name: `directions by ${kind}`, make: (read: Read) => (signal: AbortSignal) => createGetDirectionsTool({
    getEventWithVenue: async (_id, current) => { await read(current); return event },
    getVenueById: async (_id, current) => { await read(current); return venue },
  }).execute(kind === 'event' ? { eventId: 'event' } : { venueId: 'venue' }, { ...base, abortSignal: signal }) })),
  ...(['id', 'name'] as const).map(kind => ({ name: `venue details by ${kind}`, make: (read: Read) => (signal: AbortSignal) => createGetVenueDetailsTool({
    getVenueById: async (_id, current) => { await read(current); return venue },
    searchVenuesByName: async (_name, current) => { await read(current); return [venue] },
  }).execute(kind === 'id' ? { venueId: 'venue' } : { venueName: 'Source venue' }, { ...base, abortSignal: signal }) })),
]

describe('direct read cancellation', () => {
  for (const scenario of cases) {
    it(`${scenario.name} rejects a late successful read after cancellation`, async () => {
      const controller = new AbortController(), reason = new Error('Caller stopped the read')
      let release!: () => void
      const pending = new Promise<void>(resolve => { release = resolve })
      const run = scenario.make(async signal => {
        expect(signal).toBe(controller.signal)
        await pending // Deliberately model a transport that finishes despite cancellation.
      })(controller.signal)
      controller.abort(reason)
      release()
      await expect(run).rejects.toBe(reason)
    })
    it(`${scenario.name} starts no read when already cancelled`, async () => {
      const controller = new AbortController(), reason = new Error('Already stopped')
      let reads = 0
      controller.abort(reason)
      await expect(scenario.make(async () => { reads++ })(controller.signal)).rejects.toBe(reason)
      expect(reads).toBe(0)
    })
  }
  it('cancelled venue lookup cannot start name fallback', async () => {
    const controller = new AbortController(), reason = new Error('Stop before name fallback')
    let searches = 0
    const tool = createGetVenueDetailsTool({
      getVenueById: async () => { controller.abort(reason); return null as unknown as Venue },
      searchVenuesByName: async () => { searches++; return [venue] },
    })
    await expect(tool.execute({ venueId: 'venue', venueName: 'Source venue' }, { ...base, abortSignal: controller.signal })).rejects.toBe(reason)
    expect(searches).toBe(0)
  })
})
