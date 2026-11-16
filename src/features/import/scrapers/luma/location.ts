/**
 * Where a Luma event is, from the `geo_address_info` and `coordinate` that both
 * the listing (`/discover/get-paginated-events`) and the detail (`/event/get`)
 * calls return.
 *
 * Guests-only events come back with `mode: 'obfuscated'`: only the city, the
 * barrio, and a fuzzed coordinate. Their address is shared after registration,
 * so they are hidden and never get a venue, whatever else the payload says.
 */
import type { LumaVenue } from './types.ts'

export interface LumaLocation {
  /**
   * true: the host shares the address only after registration. false: the payload carries a
   * public address. null: the payload can't tell (missing fields), so the stored flag stays.
   */
  hidden: boolean | null
  venue: (LumaVenue & { name: string }) | null
}

const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null

export function lumaLocation(geoInput: unknown, coordinateInput: unknown): LumaLocation {
  if (!geoInput || typeof geoInput !== 'object') return { hidden: null, venue: null }
  const geo = geoInput as Record<string, unknown>
  if (geo.mode === 'obfuscated') return { hidden: true, venue: null }
  const name = text(geo.address)
  // A city or barrio alone is rejected later by `isAreaOnlyVenueName` in venue settlement.
  if (typeof geo.mode !== 'string' || !name) return { hidden: null, venue: null }
  const coordinate = (coordinateInput ?? {}) as { latitude?: unknown; longitude?: unknown }
  const fullAddress = text(geo.full_address)
  return {
    hidden: false,
    venue: {
      name,
      address: fullAddress,
      // The barrio; Luma's `city` is often a postal-code fragment ("ACY").
      city: text(geo.sublocality),
      latitude: typeof coordinate.latitude === 'number' ? coordinate.latitude : null,
      longitude: typeof coordinate.longitude === 'number' ? coordinate.longitude : null,
      full_address: fullAddress,
    },
  }
}
