import { createServerFn } from '@tanstack/react-start'
import { getVenues, updateVenue } from '../db/client'
import { requireAdminAccess, mapToNeighborhood } from './utils'
import type { Venue, Neighborhood } from '../types'

// Nominatim API response types
interface NominatimAddress {
  house_number?: string
  road?: string
  neighbourhood?: string
  suburb?: string
  city?: string
  state?: string
  postcode?: string
  country?: string
}

interface NominatimResult {
  display_name: string
  address: NominatimAddress
  lat: string
  lon: string
}

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
 * Call Nominatim API to search for a venue
 * Includes required User-Agent header per Nominatim usage policy
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

  const results = await response.json() as NominatimResult[]

  if (!results || results.length === 0) {
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
 */
export const enrichVenuesWithNominatimAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { venues: VenueEnrichmentInput[] }) => data)
  .handler(async ({ data: { venues } }): Promise<VenueEnrichmentOutput> => {
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

      // Rate limiting: wait 1 second between requests (except for last one)
      if (i < venues.length - 1) {
        await delay(1000)
      }
    }

    console.log(`[venue-enrichment] Completed: ${enriched}/${venues.length} enriched, ${errors.length} errors`)

    return {
      success: true,
      enriched,
      total: venues.length,
      errors,
    }
  })
