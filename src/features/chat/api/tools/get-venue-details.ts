/**
 * get_venue_details Tool
 *
 * Gets detailed information about a specific venue.
 * Can search by venue ID or venue name.
 */

import { z } from 'zod'
import { defineTool } from './types.ts'
import { getVenueById, searchVenuesByName } from '#shared/lib/db/client.server.ts'
import { formatVenueForClaude } from './utils.ts'

// ============================================================================
// INPUT SCHEMA
// ============================================================================

export const getVenueDetailsInputSchema = z.object({
  venueId: z.string().optional().describe('The venue ID (if known from a previous event search)'),
  venueName: z.string().optional().describe('The name of the venue to search for'),
}).refine(
  data => data.venueId !== undefined || data.venueName !== undefined,
  { message: 'At least one of venueId or venueName must be provided' }
)

export type GetVenueDetailsInput = z.infer<typeof getVenueDetailsInputSchema>

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const getVenueDetailsTool = defineTool({
  name: 'get_venue_details',

  description: `Get detailed information about a specific venue, including website, Instagram, and address. Use this when users ask about a venue's website, contact info, or want more details about where an event is held.`,

  inputSchema: getVenueDetailsInputSchema,

  anthropicSchema: {
    type: 'object',
    properties: {
      venueId: {
        type: 'string',
        description: 'The venue ID (if known from a previous event search)',
      },
      venueName: {
        type: 'string',
        description: 'The name of the venue to search for',
      },
    },
  },

  requiresAuth: false,

  execute: async (input) => {
    console.log('[DEBUG] Get venue details input:', JSON.stringify(input))

    let venue = null

    // If we have a venue ID, fetch directly
    if (input.venueId) {
      try {
        venue = await getVenueById(input.venueId)
      } catch {
        console.log('[DEBUG] Venue not found by ID:', input.venueId)
      }
    }

    // Otherwise search by name
    if (!venue && input.venueName) {
      const venues = await searchVenuesByName(input.venueName)
      if (venues.length > 0) {
        venue = venues[0] // Return the best match
      }
    }

    console.log(`[DEBUG] get_venue_details returned: ${venue?.name ?? 'not found'}`)

    return {
      success: !!venue,
      formatted: formatVenueForClaude(venue),
      venue: venue
        ? {
            venueId: venue.id ?? null,
            venueName: venue.name,
            neighborhood: venue.neighborhood ?? null,
            address: venue.address ?? null,
            website: venue.website ?? null,
            instagram: venue.instagram_handle ?? null,
          }
        : null,
      metadata: {
        found: !!venue,
      },
    }
  },
})
