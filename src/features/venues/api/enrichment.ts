import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getVenues, updateVenue } from '@/shared/lib/db/client'
import { requireAdminAccess, mapToNeighborhood } from '@/shared/lib/admin-utils'
import type { Venue, Neighborhood } from '@/shared/lib/types'
import type {
  NominatimEnrichProgress,
  NominatimEnrichComplete,
  NominatimEnrichUpdate,
} from '@/shared/lib/streaming-types'

// ============================================================================
// NOMINATIM API RESPONSE VALIDATION
// ============================================================================

/**
 * Zod schema for Nominatim address details
 * Based on: https://nominatim.org/release-docs/latest/api/Output/#addressdetails
 */
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
}).passthrough() // Allow additional fields we don't use

/**
 * Zod schema for a single Nominatim search result
 * Based on: https://nominatim.org/release-docs/latest/api/Output/
 */
const nominatimResultSchema = z.object({
  place_id: z.number().optional(),
  licence: z.string().optional(),
  osm_type: z.string().optional(),
  osm_id: z.number().optional(),
  boundingbox: z.array(z.string()).optional(),
  lat: z.string(),
  lon: z.string(),
  display_name: z.string(),
  class: z.string().optional(),
  type: z.string().optional(),
  importance: z.number().optional(),
  address: nominatimAddressSchema,
}).passthrough() // Allow additional fields

/**
 * Zod schema for Nominatim search API response (array of results)
 */
const nominatimResponseSchema = z.array(nominatimResultSchema)

// Inferred types from Zod schemas
type NominatimAddress = z.infer<typeof nominatimAddressSchema>
type NominatimResult = z.infer<typeof nominatimResultSchema>

// Enrichment types
export interface VenueEnrichmentInput {
  venueId: string
  venueName: string
}

export interface VenueEnrichmentOutput {
  success: boolean
  enriched: number
  total: number
  errors: Array<{ venueId: string; venueName: string; error: string }>
}

// Re-export streaming types with backwards compatible names
export type VenueEnrichmentProgress = NominatimEnrichProgress
export type VenueEnrichmentComplete = NominatimEnrichComplete
export type VenueEnrichmentUpdate = NominatimEnrichUpdate

/**
 * Map Nominatim neighbourhood/suburb to valid CABA Neighborhood.
 * Uses the neighbourhood field first (more specific), then falls back to suburb.
 */
export function mapNominatimNeighborhood(
  neighbourhood: string | undefined,
  suburb: string | undefined
): Neighborhood | null {
  // Try neighbourhood first (more specific, e.g., "Palermo Hollywood")
  if (neighbourhood) {
    const mapped = mapToNeighborhood(neighbourhood)
    if (mapped) return mapped
  }

  // Fall back to suburb (e.g., "Palermo")
  if (suburb) {
    const mapped = mapToNeighborhood(suburb)
    if (mapped) return mapped
  }

  return null
}

/**
 * Build formatted address from Nominatim address components
 */
function buildAddress(address: NominatimAddress): string | null {
  const parts: string[] = []

  // Street address
  if (address.road) {
    if (address.house_number) {
      parts.push(`${address.road} ${address.house_number}`)
    } else {
      parts.push(address.road)
    }
  }

  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * Attempt to extract partial data from an invalid Nominatim response.
 * Used as a fallback when full schema validation fails.
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

  // At minimum we need lat, lon, and display_name
  if (
    typeof result.lat !== 'string' ||
    typeof result.lon !== 'string' ||
    typeof result.display_name !== 'string'
  ) {
    return null
  }

  // Build a partial result with what we can extract
  const address: NominatimAddress = {}

  if (typeof result.address === 'object' && result.address !== null) {
    const rawAddress = result.address as Record<string, unknown>
    if (typeof rawAddress.house_number === 'string') address.house_number = rawAddress.house_number
    if (typeof rawAddress.road === 'string') address.road = rawAddress.road
    if (typeof rawAddress.neighbourhood === 'string') address.neighbourhood = rawAddress.neighbourhood
    if (typeof rawAddress.suburb === 'string') address.suburb = rawAddress.suburb
    if (typeof rawAddress.city === 'string') address.city = rawAddress.city
    if (typeof rawAddress.town === 'string') address.town = rawAddress.town
    if (typeof rawAddress.village === 'string') address.village = rawAddress.village
    if (typeof rawAddress.municipality === 'string') address.municipality = rawAddress.municipality
    if (typeof rawAddress.state === 'string') address.state = rawAddress.state
    if (typeof rawAddress.postcode === 'string') address.postcode = rawAddress.postcode
    if (typeof rawAddress.country === 'string') address.country = rawAddress.country
    if (typeof rawAddress.country_code === 'string') address.country_code = rawAddress.country_code
  }

  return {
    lat: result.lat,
    lon: result.lon,
    display_name: result.display_name,
    address,
    // Optional fields with type checks
    ...(typeof result.place_id === 'number' && { place_id: result.place_id }),
    ...(typeof result.osm_type === 'string' && { osm_type: result.osm_type }),
    ...(typeof result.osm_id === 'number' && { osm_id: result.osm_id }),
    ...(typeof result.class === 'string' && { class: result.class }),
    ...(typeof result.type === 'string' && { type: result.type }),
    ...(typeof result.importance === 'number' && { importance: result.importance }),
  }
}

/**
 * Call Nominatim API to search for a venue
 * Includes required User-Agent header per Nominatim usage policy
 * Validates response with Zod schema for type safety
 * Falls back to partial data extraction if validation fails
 */
async function searchNominatim(venueName: string): Promise<NominatimResult | null> {
  const query = encodeURIComponent(`${venueName} Buenos Aires Argentina`)
  const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&addressdetails=1&limit=1`

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'BAEventos/1.0 (baeventos.com)',
    },
    signal: AbortSignal.timeout(10000), // 10 second timeout
  })

  if (!response.ok) {
    throw new Error(`Nominatim API error: ${response.status} ${response.statusText}`)
  }

  const rawData: unknown = await response.json()

  // Validate response with Zod schema
  const parseResult = nominatimResponseSchema.safeParse(rawData)

  if (!parseResult.success) {
    // Log the validation error but don't crash - try to extract partial data
    console.warn('[Nominatim] Schema validation failed:', parseResult.error.format())
    console.warn('[Nominatim] Attempting to extract partial data from response')

    const partialResult = extractPartialNominatimData(rawData)
    if (partialResult) {
      console.log('[Nominatim] Successfully extracted partial data')
      return partialResult
    }

    console.error('[Nominatim] Failed to extract partial data from invalid response')
    return null
  }

  const results = parseResult.data

  if (results.length === 0) {
    return null
  }

  return results[0]
}

/**
 * Delay helper for rate limiting
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Process a single venue enrichment
 */
async function enrichSingleVenue(
  venueId: string,
  venueName: string,
  client: Awaited<ReturnType<typeof requireAdminAccess>>
): Promise<{ venueId: string; venueName: string; success: boolean; error?: string }> {
  console.log(`[venue-enrichment] Processing: ${venueName}`)

  try {
    const result = await searchNominatim(venueName)

    if (!result) {
      return {
        venueId,
        venueName,
        success: false,
        error: 'No results found on OpenStreetMap',
      }
    }

    // Extract address and neighborhood
    const address = buildAddress(result.address)
    const neighborhood = mapNominatimNeighborhood(
      result.address.neighbourhood,
      result.address.suburb
    )

    // Only update if we found something useful
    if (!address && !neighborhood) {
      return {
        venueId,
        venueName,
        success: false,
        error: 'Found location but no address or neighborhood data',
      }
    }

    // Build update object with only non-null values
    const updates: { address?: string; neighborhood?: Neighborhood } = {}
    if (address) updates.address = address
    if (neighborhood) updates.neighborhood = neighborhood

    await updateVenue(venueId, updates, client)

    console.log(`[venue-enrichment] Enriched ${venueName}: address=${address}, neighborhood=${neighborhood}`)

    return { venueId, venueName, success: true }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[venue-enrichment] Failed to enrich ${venueName}:`, errorMsg)

    // Retry once on rate limit or server errors
    if (errorMsg.includes('429') || errorMsg.includes('5')) {
      console.log(`[venue-enrichment] Retrying ${venueName} after 2s delay...`)
      await delay(2000)
      try {
        const result = await searchNominatim(venueName)
        if (result) {
          const address = buildAddress(result.address)
          const neighborhood = mapNominatimNeighborhood(
            result.address.neighbourhood,
            result.address.suburb
          )
          if (address || neighborhood) {
            const updates: { address?: string; neighborhood?: Neighborhood } = {}
            if (address) updates.address = address
            if (neighborhood) updates.neighborhood = neighborhood
            await updateVenue(venueId, updates, client)
            return { venueId, venueName, success: true }
          }
        }
      } catch {
        // Retry failed, fall through to error
      }
    }

    return {
      venueId,
      venueName,
      success: false,
      error: errorMsg,
    }
  }
}

/**
 * Get venues that need address or neighborhood enrichment
 */
export const getVenuesNeedingEnrichmentAction = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Venue[]> => {
    await requireAdminAccess()
    const venues = await getVenues(1000)
    return venues.filter((v) => !v.address || !v.neighborhood)
  }
)

/**
 * Enrich venues with address and neighborhood from Nominatim API
 * Processes sequentially with 1 second delay to respect rate limits
 * Uses async generator to stream progress updates to the client
 */
export const enrichVenuesWithNominatimAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { venues: VenueEnrichmentInput[] }) => data)
  .handler(async function* ({ data: { venues } }): AsyncGenerator<VenueEnrichmentUpdate> {
    const client = await requireAdminAccess()
    console.log(`[venue-enrichment] Starting enrichment for ${venues.length} venues`)

    const errors: Array<{ venueId: string; venueName: string; error: string }> = []
    let enriched = 0

    // Process sequentially with rate limiting (1 request per second)
    for (let i = 0; i < venues.length; i++) {
      const { venueId, venueName } = venues[i]

      const result = await enrichSingleVenue(venueId, venueName, client)

      if (result.success) {
        enriched++
      } else if (result.error) {
        errors.push({
          venueId: result.venueId,
          venueName: result.venueName,
          error: result.error,
        })
      }

      // Yield progress update after each venue
      const progressUpdate: VenueEnrichmentProgress = {
        type: 'progress',
        current: i + 1,
        total: venues.length,
        venueName: result.venueName,
        success: result.success,
        error: result.error,
      }
      yield progressUpdate

      // Rate limiting: wait 1 second between requests (except for last one)
      if (i < venues.length - 1) {
        await delay(1000)
      }
    }

    console.log(`[venue-enrichment] Completed: ${enriched}/${venues.length} enriched, ${errors.length} errors`)

    // Yield final completion result
    const completeUpdate: VenueEnrichmentComplete = {
      type: 'complete',
      enriched,
      total: venues.length,
      errors,
    }
    yield completeUpdate
  })
