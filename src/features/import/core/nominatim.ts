/**
 * Nominatim API Utilities
 *
 * Shared functions for geocoding and reverse geocoding using OpenStreetMap's Nominatim API.
 * Extracted for reuse in both server functions and Trigger.dev jobs.
 */
import { z } from 'zod'
import { mapToNeighborhood } from '#shared/lib/utils/neighborhood.ts'
import type { Neighborhood } from '#shared/lib/types.ts'

// ============================================================================
// NOMINATIM API RESPONSE VALIDATION
// ============================================================================

const nominatimAddressSchema = z.object({
  house_number: z.string().optional(),
  road: z.string().optional(),
  neighbourhood: z.string().optional(),
  suburb: z.string().optional(),
  city: z.string().optional(),
  town: z.string().optional(),
  village: z.string().optional(),
  municipality: z.string().optional(),
  state: z.string().optional(),
  postcode: z.string().optional(),
  country: z.string().optional(),
  country_code: z.string().optional(),
}).passthrough()

const nominatimExtratagsSchema = z.object({
  website: z.string().optional(),
  'contact:website': z.string().optional(),
  'contact:instagram': z.string().optional(),
  instagram: z.string().optional(),
}).passthrough()

const nominatimResultSchema = z.object({
  place_id: z.number().optional(),
  lat: z.string(),
  lon: z.string(),
  display_name: z.string(),
  address: nominatimAddressSchema,
  extratags: nominatimExtratagsSchema.optional(),
}).passthrough()

const nominatimResponseSchema = z.array(nominatimResultSchema)

// Types
export type NominatimAddress = z.infer<typeof nominatimAddressSchema>
export type NominatimExtratags = z.infer<typeof nominatimExtratagsSchema>
export type NominatimResult = z.infer<typeof nominatimResultSchema>

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Delay helper for rate limiting
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Map Nominatim neighbourhood/suburb to valid CABA Neighborhood.
 */
export function mapNominatimNeighborhood(
  neighbourhood: string | undefined,
  suburb: string | undefined
): Neighborhood | null {
  if (neighbourhood) {
    const mapped = mapToNeighborhood(neighbourhood)
    if (mapped) return mapped
  }
  if (suburb) {
    const mapped = mapToNeighborhood(suburb)
    if (mapped) return mapped
  }
  return null
}

/**
 * Build formatted address from Nominatim address components
 */
export function buildAddress(address: NominatimAddress): string | null {
  if (address.road) {
    if (address.house_number) {
      return `${address.road} ${address.house_number}`
    }
    return address.road
  }
  return null
}

/**
 * Extract partial data from an invalid Nominatim response (fallback)
 */
function extractPartialNominatimData(rawData: unknown): NominatimResult | null {
  if (!Array.isArray(rawData) || rawData.length === 0) {
    return null
  }

  const firstResult = rawData[0]
  if (typeof firstResult !== 'object' || firstResult === null) {
    return null
  }

  const result = firstResult as Record<string, unknown>

  if (
    typeof result.lat !== 'string' ||
    typeof result.lon !== 'string' ||
    typeof result.display_name !== 'string'
  ) {
    return null
  }

  const address: NominatimAddress = {}

  if (typeof result.address === 'object' && result.address !== null) {
    const rawAddress = result.address as Record<string, unknown>
    if (typeof rawAddress.house_number === 'string') address.house_number = rawAddress.house_number
    if (typeof rawAddress.road === 'string') address.road = rawAddress.road
    if (typeof rawAddress.neighbourhood === 'string') address.neighbourhood = rawAddress.neighbourhood
    if (typeof rawAddress.suburb === 'string') address.suburb = rawAddress.suburb
    if (typeof rawAddress.city === 'string') address.city = rawAddress.city
  }

  let extratags: NominatimExtratags | undefined
  if (typeof result.extratags === 'object' && result.extratags !== null) {
    const rawExtratags = result.extratags as Record<string, unknown>
    extratags = {}
    if (typeof rawExtratags.website === 'string') extratags.website = rawExtratags.website
    if (typeof rawExtratags['contact:website'] === 'string') extratags['contact:website'] = rawExtratags['contact:website']
  }

  return {
    lat: result.lat,
    lon: result.lon,
    display_name: result.display_name,
    address,
    extratags,
  }
}

// ============================================================================
// NOMINATIM API FUNCTIONS
// ============================================================================

/**
 * Search for a venue using Nominatim API.
 * Includes required User-Agent header per Nominatim usage policy.
 */
export async function searchNominatim(
  query: string,
  retries: number = 1
): Promise<NominatimResult | null> {
  const encodedQuery = encodeURIComponent(`${query} Buenos Aires Argentina`)
  const url = `https://nominatim.openstreetmap.org/search?q=${encodedQuery}&format=json&addressdetails=1&extratags=1&limit=1`

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'BAEventos/1.0 (baeventos.com)',
      },
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) {
      if (response.status === 429) {
        console.warn(`[Nominatim] Rate limited for "${query}", skipping lookup`)
        return null
      }
      throw new Error(`Nominatim API error: ${response.status} ${response.statusText}`)
    }

    const rawData: unknown = await response.json()
    const parseResult = nominatimResponseSchema.safeParse(rawData)

    if (!parseResult.success) {
      console.warn('[Nominatim] Schema validation failed, attempting partial extraction')
      const partialResult = extractPartialNominatimData(rawData)
      return partialResult
    }

    const results = parseResult.data
    return results.length > 0 ? results[0] : null
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    if ((errorMsg.includes('timeout') || errorMsg.includes('aborted')) && retries > 0) {
      console.warn(`[Nominatim] Timeout for "${query}", retrying... (${retries} retries left)`)
      await delay(2000)
      return searchNominatim(query, retries - 1)
    }
    if (errorMsg.includes('timeout') || errorMsg.includes('aborted')) {
      console.warn(`[Nominatim] Timeout for "${query}", skipping lookup`)
      return null
    }
    throw error
  }
}

/**
 * Reverse geocode coordinates to get neighborhood.
 * More accurate than venue name search for venues with exact coordinates.
 */
export async function reverseGeocodeNeighborhood(
  lat: number,
  lng: number,
  retries: number = 1
): Promise<Neighborhood | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'BAEventos/1.0 (baeventos.com)',
      },
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) {
      console.warn(`[reverse-geocode] API error: ${response.status} ${response.statusText}`)
      return null
    }

    const data = await response.json()

    if (!data || !data.address) {
      return null
    }

    return mapNominatimNeighborhood(
      data.address.neighbourhood,
      data.address.suburb
    )
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    if (errorMsg.includes('timeout') && retries > 0) {
      console.warn(`[reverse-geocode] Timeout, retrying... (${retries} retries left)`)
      await delay(2000)
      return reverseGeocodeNeighborhood(lat, lng, retries - 1)
    }
    console.warn(`[reverse-geocode] Error: ${errorMsg}`)
    return null
  }
}

/**
 * Look up neighborhood using tiered approach based on available data.
 *
 * Tiers (in order of accuracy):
 * 1. Direct neighborhood field (BA Tourism) - no API call needed
 * 2. Reverse geocode coordinates (Meetup, Luma, Eventbrite) - most accurate
 * 3. Address-enhanced Nominatim search - better than name alone
 * 4. Venue name only search (Passline fallback) - least reliable
 */
export async function lookupNeighborhoodTiered(input: {
  venueName: string
  neighborhood?: string | null
  coordinates?: { lat: number; lng: number } | null
  address?: string | null
}): Promise<{ neighborhood: Neighborhood | null; method: string }> {
  // Tier 1: Direct neighborhood field
  if (input.neighborhood) {
    const mapped = mapToNeighborhood(input.neighborhood)
    if (mapped) {
      return { neighborhood: mapped, method: 'direct' }
    }
  }

  // Tier 2: Reverse geocode coordinates
  if (input.coordinates) {
    const neighborhood = await reverseGeocodeNeighborhood(
      input.coordinates.lat,
      input.coordinates.lng
    )
    if (neighborhood) {
      return { neighborhood, method: 'coordinates' }
    }
  }

  // Tier 3: Address-enhanced search
  if (input.address) {
    const result = await searchNominatim(`${input.venueName} ${input.address}`)
    if (result) {
      const neighborhood = mapNominatimNeighborhood(
        result.address.neighbourhood,
        result.address.suburb
      )
      if (neighborhood) {
        return { neighborhood, method: 'address' }
      }
    }
  }

  // Tier 4: Venue name only search
  const result = await searchNominatim(input.venueName)
  if (result) {
    const neighborhood = mapNominatimNeighborhood(
      result.address.neighbourhood,
      result.address.suburb
    )
    if (neighborhood) {
      return { neighborhood, method: 'name-only' }
    }
  }

  return { neighborhood: null, method: 'none' }
}

// ============================================================================
// ADDRESS-LIKE VENUE DETECTION & RESOLUTION
// ============================================================================

/**
 * Patterns that indicate a venue name is actually a street address.
 * These are common Buenos Aires address formats.
 */
const ADDRESS_PATTERNS = [
  /^Av\.?\s+/i,                              // Av. Corrientes, Av Santa Fe
  /^Avenida\s+/i,                            // Avenida de Mayo
  /^Calle\s+/i,                              // Calle Florida
  /^Pasaje\s+/i,                             // Pasaje Something
  /^Cnel\.?\s+/i,                            // Cnel. Niceto Vega
  /^\d+\s+[A-Za-z]/,                         // 1234 Thames (number first)
  /[A-Za-z]+\s+\d{2,5}$/,                    // Thames 1234 (street + number at end)
  /[A-Za-z]+\s+\d{2,5}\s*,/,                 // Thames 1234, CABA
  /\s+(y|&)\s+/i,                            // Corrientes y Callao (intersection)
  /\s+esq\.?\s+/i,                           // Corrientes esq. Callao
  /\s+entre\s+/i,                            // Maure 3955 entre Fraga y Guevara
  /,\s*(piso|local|of|depto|dto)/i,          // ..., Piso 5
  /^(Piso|Local|Oficina|Depto)\s+/i,         // Piso 5 (starts with floor/unit)
]

/**
 * Check if a venue name looks like a street address rather than a business name.
 */
export function isAddressLikeVenueName(name: string): boolean {
  if (!name) return false
  const trimmed = name.trim()
  return ADDRESS_PATTERNS.some(pattern => pattern.test(trimmed))
}

/**
 * Look up a business/venue at a given address using Nominatim.
 * Returns the business name if found, null otherwise.
 *
 * This searches for the address and checks if Nominatim returns a POI (point of interest)
 * with a name different from just the address.
 */
export async function lookupBusinessAtAddress(
  address: string
): Promise<{ name: string | null; neighborhood: Neighborhood | null; fullAddress: string | null }> {
  // Search Nominatim with the address
  const result = await searchNominatim(address)

  if (!result) {
    return { name: null, neighborhood: null, fullAddress: null }
  }

  // Extract neighborhood
  const neighborhood = mapNominatimNeighborhood(
    result.address.neighbourhood,
    result.address.suburb
  )

  // Build the full address
  const fullAddress = buildAddress(result.address)

  // Check if Nominatim found a named place (not just a street address)
  // The display_name often contains the business name at the start
  // Format is usually: "Business Name, Street, Neighborhood, City, ..."
  const displayParts = result.display_name.split(',').map(p => p.trim())

  // The first part might be a business name if it's different from the road
  const firstPart = displayParts[0]
  const road = result.address.road
  const houseNumber = result.address.house_number

  // If the first part is just the street address, there's no business name
  const isJustAddress =
    firstPart === road ||
    firstPart === `${road} ${houseNumber}` ||
    firstPart === `${houseNumber} ${road}` ||
    firstPart === houseNumber ||
    // Check if first part matches the search query (means no POI found)
    firstPart.toLowerCase() === address.toLowerCase()

  if (isJustAddress) {
    return { name: null, neighborhood, fullAddress }
  }

  // Found a business name!
  return { name: firstPart, neighborhood, fullAddress }
}

/**
 * Try to find an existing venue by address (checking the address field).
 */
export async function findVenueByAddress(
  client: unknown, // SupabaseClient - using unknown to avoid circular import
  address: string
): Promise<{ id: string; name: string } | null> {
  // Normalize address for comparison
  const normalizedAddress = address.trim().toLowerCase()

  // Query venues where address contains this string
  const supabase = client as { from: (table: string) => unknown }
  const { data, error } = await (supabase.from('venues') as {
    select: (cols: string) => { ilike: (col: string, val: string) => { limit: (n: number) => Promise<{ data: Array<{ id: string; name: string; address: string }> | null; error: unknown }> } }
  })
    .select('id, name, address')
    .ilike('address', `%${normalizedAddress}%`)
    .limit(1)

  if (error || !data || data.length === 0) {
    return null
  }

  return { id: data[0].id, name: data[0].name }
}
