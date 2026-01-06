import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getVenues, updateVenue, supabase } from '@/shared/lib/db/client'
import { requireAdminAccess, mapToNeighborhood } from '@/shared/lib/admin-utils'
import type { Venue, Neighborhood } from '@/shared/lib/types'
import type {
  NominatimEnrichProgress,
  NominatimEnrichComplete,
  NominatimEnrichUpdate,
  NeighborhoodLookupUpdate,
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
 * Zod schema for Nominatim extratags (optional OSM metadata)
 * These fields are only present if the data exists in OpenStreetMap
 */
const nominatimExtratagsSchema = z.object({
  website: z.string().optional(),
  'contact:website': z.string().optional(),
  'contact:instagram': z.string().optional(),
  instagram: z.string().optional(),
  'contact:facebook': z.string().optional(),
  facebook: z.string().optional(),
  phone: z.string().optional(),
  'contact:phone': z.string().optional(),
  opening_hours: z.string().optional(),
  wikidata: z.string().optional(),
  wikipedia: z.string().optional(),
}).passthrough() // Allow additional fields

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
  extratags: nominatimExtratagsSchema.optional(),
}).passthrough() // Allow additional fields

/**
 * Zod schema for Nominatim search API response (array of results)
 */
const nominatimResponseSchema = z.array(nominatimResultSchema)

// Inferred types from Zod schemas
type NominatimAddress = z.infer<typeof nominatimAddressSchema>
type NominatimExtratags = z.infer<typeof nominatimExtratagsSchema>
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
 * Extract website URL from Nominatim extratags.
 * Tries multiple field names as OSM tagging varies.
 */
function extractWebsite(extratags: NominatimExtratags | undefined): string | null {
  if (!extratags) return null
  return extratags.website || extratags['contact:website'] || null
}

/**
 * Extract Instagram handle from Nominatim extratags.
 * Normalizes to just the handle (removes URL prefix if present).
 */
function extractInstagramHandle(extratags: NominatimExtratags | undefined): string | null {
  if (!extratags) return null
  const raw = extratags.instagram || extratags['contact:instagram']
  if (!raw) return null

  // Normalize: extract handle from URL if needed
  // e.g., "https://instagram.com/venue_name" -> "venue_name"
  const match = raw.match(/(?:instagram\.com\/)?@?([a-zA-Z0-9._]+)\/?$/)
  return match ? match[1] : raw
}

/**
 * Scrape a venue website to find Instagram handle.
 * Looks for instagram.com links in the HTML.
 */
async function scrapeInstagramFromWebsite(websiteUrl: string): Promise<string | null> {
  try {
    const response = await fetch(websiteUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BAEventos/1.0; +https://baeventos.com)',
      },
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    })

    if (!response.ok) {
      console.log(`[venue-enrichment] Website returned ${response.status}: ${websiteUrl}`)
      return null
    }

    const html = await response.text()

    // Look for Instagram URLs in the HTML
    // Matches: instagram.com/username, www.instagram.com/username, https://instagram.com/username
    const instagramPattern = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)\/?/gi
    const matches = html.matchAll(instagramPattern)

    // Collect unique handles, excluding common non-profile paths
    const excludedPaths = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct', 'about', 'legal', 'privacy', 'terms'])
    const handles = new Set<string>()

    for (const match of matches) {
      const handle = match[1].toLowerCase()
      if (!excludedPaths.has(handle) && handle.length > 1) {
        handles.add(handle)
      }
    }

    if (handles.size === 0) {
      return null
    }

    // If multiple handles found, prefer the first one (usually in header/footer)
    const handle = Array.from(handles)[0]
    console.log(`[venue-enrichment] Found Instagram @${handle} from website: ${websiteUrl}`)
    return handle
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    console.log(`[venue-enrichment] Failed to scrape website for Instagram: ${msg}`)
    return null
  }
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

  // Extract extratags if present
  let extratags: NominatimExtratags | undefined
  if (typeof result.extratags === 'object' && result.extratags !== null) {
    const rawExtratags = result.extratags as Record<string, unknown>
    extratags = {}
    if (typeof rawExtratags.website === 'string') extratags.website = rawExtratags.website
    if (typeof rawExtratags['contact:website'] === 'string') extratags['contact:website'] = rawExtratags['contact:website']
    if (typeof rawExtratags.instagram === 'string') extratags.instagram = rawExtratags.instagram
    if (typeof rawExtratags['contact:instagram'] === 'string') extratags['contact:instagram'] = rawExtratags['contact:instagram']
  }

  return {
    lat: result.lat,
    lon: result.lon,
    display_name: result.display_name,
    address,
    extratags,
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
  const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&addressdetails=1&extratags=1&limit=1`

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
      await updateVenue(venueId, {
        enrichment_status: 'failed',
        enrichment_error: 'No results found on OpenStreetMap',
      }, client)
      return {
        venueId,
        venueName,
        success: false,
        error: 'No results found on OpenStreetMap',
      }
    }

    // Extract address, neighborhood, website, and instagram
    const address = buildAddress(result.address)
    const neighborhood = mapNominatimNeighborhood(
      result.address.neighbourhood,
      result.address.suburb
    )
    const website = extractWebsite(result.extratags)
    let instagramHandle = extractInstagramHandle(result.extratags)

    // If we have a website but no Instagram from OSM, try scraping the website
    if (website && !instagramHandle) {
      instagramHandle = await scrapeInstagramFromWebsite(website)
    }

    // Only update if we found something useful
    if (!address && !neighborhood && !website && !instagramHandle) {
      await updateVenue(venueId, {
        enrichment_status: 'failed',
        enrichment_error: 'Found location but no useful data (address, neighborhood, website, or instagram)',
      }, client)
      return {
        venueId,
        venueName,
        success: false,
        error: 'Found location but no useful data (address, neighborhood, website, or instagram)',
      }
    }

    // Build update object with only non-null values
    const updates: { address?: string; neighborhood?: Neighborhood; website?: string; instagram_handle?: string; enrichment_status: 'completed'; enriched_at: string } = {
      enrichment_status: 'completed',
      enriched_at: new Date().toISOString(),
    }
    if (address) updates.address = address
    if (neighborhood) updates.neighborhood = neighborhood
    if (website) updates.website = website
    if (instagramHandle) updates.instagram_handle = instagramHandle

    await updateVenue(venueId, updates, client)

    console.log(`[venue-enrichment] Enriched ${venueName}: address=${address}, neighborhood=${neighborhood}, website=${website}, instagram=${instagramHandle}`)

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
          const website = extractWebsite(result.extratags)
          let instagramHandle = extractInstagramHandle(result.extratags)
          // Try scraping website for Instagram if we have website but no Instagram
          if (website && !instagramHandle) {
            instagramHandle = await scrapeInstagramFromWebsite(website)
          }
          if (address || neighborhood || website || instagramHandle) {
            const updates: { address?: string; neighborhood?: Neighborhood; website?: string; instagram_handle?: string; enrichment_status: 'completed'; enriched_at: string } = {
              enrichment_status: 'completed',
              enriched_at: new Date().toISOString(),
            }
            if (address) updates.address = address
            if (neighborhood) updates.neighborhood = neighborhood
            if (website) updates.website = website
            if (instagramHandle) updates.instagram_handle = instagramHandle
            await updateVenue(venueId, updates, client)
            return { venueId, venueName, success: true }
          }
        }
      } catch {
        // Retry failed, fall through to error
      }
    }

    // Mark as failed with error message
    await updateVenue(venueId, {
      enrichment_status: 'failed',
      enrichment_error: errorMsg,
    }, client)

    return {
      venueId,
      venueName,
      success: false,
      error: errorMsg,
    }
  }
}

/**
 * Get venues that need enrichment (based on enrichment_status)
 */
export const getVenuesNeedingEnrichmentAction = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Venue[]> => {
    await requireAdminAccess()
    const venues = await getVenues(1000)
    return venues.filter((v) => v.enrichment_status === 'pending')
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

// ============================================================================
// PENDING QUERIES FOR AUTO-ENRICHMENT
// ============================================================================

/**
 * Get recently created venues that need enrichment.
 * Used to identify which venues to auto-enrich after import completes.
 */
export const getRecentlyCreatedPendingVenuesAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { createdAfter: string }) => data)
  .handler(async ({ data: { createdAfter } }) => {
    await requireAdminAccess()
    const { data: venues, error } = await supabase
      .from('venues')
      .select('id, name')
      .eq('enrichment_status', 'pending')
      .gte('created_at', createdAfter)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[venue-enrichment] Failed to get recently created pending venues:', error)
      return []
    }

    return (venues || []) as Array<{ id: string; name: string }>
  })

/**
 * Get all pending venues for backfill enrichment.
 */
export const getAllPendingVenuesAction = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAdminAccess()
  const { data: venues, error } = await supabase
    .from('venues')
    .select('id, name')
    .eq('enrichment_status', 'pending')
    .order('name', { ascending: true })
    .limit(200) // Reasonable batch size for Nominatim rate limiting

  if (error) {
    console.error('[venue-enrichment] Failed to get all pending venues:', error)
    return []
  }

  return (venues || []) as Array<{ id: string; name: string }>
})

// ============================================================================
// NEIGHBORHOOD LOOKUP (for import wizard - no DB updates)
// ============================================================================

/**
 * Look up neighborhoods for venue names using Nominatim API.
 * This is a lightweight version that only returns neighborhoods without
 * creating or updating any database records.
 *
 * Used by the import wizard's VenuesStep to auto-populate neighborhood dropdowns.
 */
export const lookupNeighborhoodsAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { venueNames: string[] }) => data)
  .handler(async function* ({ data: { venueNames } }): AsyncGenerator<NeighborhoodLookupUpdate> {
    await requireAdminAccess()
    console.log(`[neighborhood-lookup] Starting lookup for ${venueNames.length} venues`)

    for (let i = 0; i < venueNames.length; i++) {
      const venueName = venueNames[i]
      let neighborhood: Neighborhood | null = null
      let error: string | null = null

      try {
        const result = await searchNominatim(venueName)
        if (result) {
          neighborhood = mapNominatimNeighborhood(
            result.address.neighbourhood,
            result.address.suburb
          )
          console.log(`[neighborhood-lookup] ${venueName} -> ${neighborhood || 'not found'}`)
        } else {
          console.log(`[neighborhood-lookup] ${venueName} -> no OSM result`)
        }
      } catch (e) {
        error = e instanceof Error ? e.message : 'Unknown error'
        console.error(`[neighborhood-lookup] Error for ${venueName}:`, error)
      }

      yield {
        type: 'progress',
        current: i + 1,
        total: venueNames.length,
        venueName,
        neighborhood,
        error,
      }

      // Rate limiting: wait 1 second between requests (except for last one)
      if (i < venueNames.length - 1) {
        await delay(1000)
      }
    }

    console.log(`[neighborhood-lookup] Completed lookup for ${venueNames.length} venues`)
    yield { type: 'complete' }
  })
