/**
 * Nominatim API Utilities
 *
 * Shared functions for geocoding and reverse geocoding using OpenStreetMap's Nominatim API.
 * Extracted for reuse in both server functions and Trigger.dev jobs.
 */
import { Effect, Schema } from 'effect'
import { mapToNeighborhood } from '#shared/lib/utils/neighborhood.ts'
import type { Neighborhood } from '#shared/lib/types.ts'

// ============================================================================
// NOMINATIM API RESPONSE VALIDATION
// ============================================================================

const nominatimAddressSchema = Schema.Struct({
  house_number: Schema.optional(Schema.String),
  road: Schema.optional(Schema.String),
  neighbourhood: Schema.optional(Schema.String),
  suburb: Schema.optional(Schema.String),
  city: Schema.optional(Schema.String),
  town: Schema.optional(Schema.String),
  village: Schema.optional(Schema.String),
  municipality: Schema.optional(Schema.String),
  state: Schema.optional(Schema.String),
  postcode: Schema.optional(Schema.String),
  country: Schema.optional(Schema.String),
  country_code: Schema.optional(Schema.String),
})

const nominatimExtratagsSchema = Schema.Struct({
  website: Schema.optional(Schema.String),
  'contact:website': Schema.optional(Schema.String),
  'contact:instagram': Schema.optional(Schema.String),
  instagram: Schema.optional(Schema.String),
})

const nominatimResultSchema = Schema.Struct({
  place_id: Schema.optional(Schema.Number),
  lat: Schema.String,
  lon: Schema.String,
  display_name: Schema.String,
  address: nominatimAddressSchema,
  extratags: Schema.optional(nominatimExtratagsSchema),
})

const nominatimResponseSchema = Schema.Array(nominatimResultSchema)

// Types
export type NominatimAddress = Schema.Schema.Type<typeof nominatimAddressSchema>
export type NominatimExtratags = Schema.Schema.Type<typeof nominatimExtratagsSchema>
export type NominatimResult = Schema.Schema.Type<typeof nominatimResultSchema>

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Delay helper for rate limiting
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export const delayEffect = (ms: number) => Effect.tryPromise({
  try: () => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  catch: (error) => new NominatimRequestError(error instanceof Error ? error.message : String(error)),
})

class NominatimRequestError extends Error {
  readonly _tag = 'NominatimRequestError'
  constructor(message: string, readonly timeoutLike = false) {
    super(message)
    this.name = 'NominatimRequestError'
  }
}

class NominatimApiError extends Error {
  readonly _tag = 'NominatimApiError'
}

function timeoutLike(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
    || error instanceof Error && /timeout|aborted/i.test(error.message)
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

  const address: Record<string, string> = {}

  if (typeof result.address === 'object' && result.address !== null) {
    const rawAddress = result.address as Record<string, unknown>
    if (typeof rawAddress.house_number === 'string') address.house_number = rawAddress.house_number
    if (typeof rawAddress.road === 'string') address.road = rawAddress.road
    if (typeof rawAddress.neighbourhood === 'string') address.neighbourhood = rawAddress.neighbourhood
    if (typeof rawAddress.suburb === 'string') address.suburb = rawAddress.suburb
    if (typeof rawAddress.city === 'string') address.city = rawAddress.city
  }

  let extratags: Record<string, string> | undefined
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
    address: address as NominatimAddress,
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
export function searchNominatimEffect(query: string, retries: number = 1): Effect.Effect<NominatimResult | null, NominatimApiError | NominatimRequestError> {
  const encodedQuery = encodeURIComponent(`${query} Buenos Aires Argentina`)
  const url = `https://nominatim.openstreetmap.org/search?q=${encodedQuery}&format=json&addressdetails=1&extratags=1&limit=1`
  const attempt = Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(url, {
        headers: { 'User-Agent': 'BAEventos/1.0 (baeventos.com)' },
        signal: AbortSignal.timeout(15000),
      }),
      catch: (error) => new NominatimRequestError(error instanceof Error ? error.message : 'Unknown error', timeoutLike(error)),
    })
    if (!response.ok) {
      if (response.status === 429) {
        console.warn(`[Nominatim] Rate limited for "${query}", skipping lookup`)
        return null
      }
      return yield* Effect.fail(new NominatimApiError(`Nominatim API error: ${response.status} ${response.statusText}`))
    }
    const rawData = yield* Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: (error) => new NominatimRequestError(error instanceof Error ? error.message : 'Unknown error', timeoutLike(error)),
    })
    const parsed = Schema.decodeUnknownResult(nominatimResponseSchema)(rawData)
    return parsed._tag === 'Success'
      ? parsed.success[0] ?? null
      : extractPartialNominatimData(rawData)
  })
  return Effect.catchEager(attempt, (error) => {
    if (!(error instanceof NominatimRequestError) || !error.timeoutLike || retries <= 0) return Effect.fail(error)
    return Effect.gen(function* () {
      yield* delayEffect(2000)
      return yield* searchNominatimEffect(query, retries - 1)
    })
  })
}

/** Promise compatibility adapter. The native AbortSignal timeout and one retry remain in the Effect program. */
export async function searchNominatim(
  query: string,
  retries: number = 1
): Promise<NominatimResult | null> {
  try {
    return await Effect.runPromise(searchNominatimEffect(query, retries))
  } catch (error) {
    if (error instanceof NominatimRequestError && error.timeoutLike) {
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
export function reverseGeocodeEffect(lat: number, lng: number, retries: number = 1): Effect.Effect<Neighborhood | null, NominatimRequestError> {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`
  const responseSchema = Schema.Struct({ address: nominatimAddressSchema })
  const attempt = Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(url, {
        headers: { 'User-Agent': 'BAEventos/1.0 (baeventos.com)' },
        signal: AbortSignal.timeout(15000),
      }),
      catch: (error) => new NominatimRequestError(error instanceof Error ? error.message : 'Unknown error', timeoutLike(error)),
    })
    if (!response.ok) return null
    const raw = yield* Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: (error) => new NominatimRequestError(error instanceof Error ? error.message : 'Unknown error', timeoutLike(error)),
    })
    const parsed = Schema.decodeUnknownResult(responseSchema)(raw)
    return parsed._tag === 'Success'
      ? mapNominatimNeighborhood(parsed.success.address.neighbourhood, parsed.success.address.suburb)
      : null
  })
  return Effect.catchEager(attempt, (error) => {
    if (!error.timeoutLike || retries <= 0) return Effect.fail(error)
    return Effect.gen(function* () {
      yield* delayEffect(2000)
      return yield* reverseGeocodeEffect(lat, lng, retries - 1)
    })
  })
}

export async function reverseGeocodeNeighborhood(
  lat: number,
  lng: number,
  retries: number = 1
): Promise<Neighborhood | null> {
  try {
    return await Effect.runPromise(reverseGeocodeEffect(lat, lng, retries))
  } catch (error) {
    console.warn(`[reverse-geocode] Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
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
function searchForLookupEffect(query: string) {
  return Effect.catchEager(searchNominatimEffect(query), (error) => {
    if (error instanceof NominatimRequestError && error.timeoutLike) {
      return Effect.succeed(null)
    }
    return Effect.fail(error)
  })
}

export function lookupNeighborhoodTieredEffect(input: {
  venueName: string
  neighborhood?: string | null
  coordinates?: { lat: number; lng: number } | null
  address?: string | null
}): Effect.Effect<{ neighborhood: Neighborhood | null; method: string }, NominatimApiError | NominatimRequestError> {
  return Effect.gen(function* () {
    // Tier 1: Direct neighborhood field
    if (input.neighborhood) {
      const mapped = mapToNeighborhood(input.neighborhood)
      if (mapped) {
        return { neighborhood: mapped, method: 'direct' }
      }
    }

    // Tier 2: Reverse geocode coordinates. Reverse geocoding has always been
    // best-effort; failures fall through to the address/name tiers.
    if (input.coordinates) {
      const neighborhood = yield* Effect.catchEager(
        reverseGeocodeEffect(input.coordinates.lat, input.coordinates.lng),
        () => Effect.succeed(null)
      )
      if (neighborhood) {
        return { neighborhood, method: 'coordinates' }
      }
    }

    // Tier 3: Address-enhanced search
    if (input.address) {
      const result = yield* searchForLookupEffect(`${input.venueName} ${input.address}`)
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
    const result = yield* searchForLookupEffect(input.venueName)
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
  })
}

export async function lookupNeighborhoodTiered(input: {
  venueName: string
  neighborhood?: string | null
  coordinates?: { lat: number; lng: number } | null
  address?: string | null
}): Promise<{ neighborhood: Neighborhood | null; method: string }> {
  return Effect.runPromise(lookupNeighborhoodTieredEffect(input))
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
export function lookupBusinessAtAddressEffect(
  address: string
): Effect.Effect<{ name: string | null; neighborhood: Neighborhood | null; fullAddress: string | null }, NominatimApiError | NominatimRequestError> {
  return Effect.gen(function* () {
    // Search Nominatim with the address. Timeouts are best-effort just like
    // the legacy Promise adapter; HTTP/API failures remain typed failures.
    const result = yield* searchForLookupEffect(address)

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
  })
}

export async function lookupBusinessAtAddress(
  address: string
): Promise<{ name: string | null; neighborhood: Neighborhood | null; fullAddress: string | null }> {
  return Effect.runPromise(lookupBusinessAtAddressEffect(address))
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
