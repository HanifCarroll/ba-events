/**
 * get_directions Tool
 *
 * Generates a Google Maps directions link to an event's venue.
 */

import { z } from 'zod'
import { defineTool } from './types.ts'
import { getEventWithVenue, getVenueById } from '#shared/lib/db/client.server.ts'

// ============================================================================
// INPUT SCHEMA
// ============================================================================

export const getDirectionsInputSchema = z.object({
  eventId: z.string().optional().describe('The ID of the event to get directions to'),
  venueId: z.string().optional().describe('The ID of the venue to get directions to (use if no event ID)'),
})

export type GetDirectionsInput = z.infer<typeof getDirectionsInputSchema>

// ============================================================================
// HELPER: Generate Google Maps URL
// ============================================================================

function generateMapsUrl(address: string, venueName: string): string {
  // Use the destination parameter with the address
  // Include venue name for better search results
  const query = `${venueName}, ${address}, Buenos Aires, Argentina`
  const encodedQuery = encodeURIComponent(query)
  return `https://www.google.com/maps/dir/?api=1&destination=${encodedQuery}`
}

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const createGetDirectionsTool = (readers = { getEventWithVenue, getVenueById }) => defineTool({
  name: 'get_directions',

  description: `Generate a Google Maps directions link to an event's venue.
Use when the user asks for directions: "how do I get there?", "directions", "where is it?", "map".
Provide either an eventId or venueId. If both are provided, eventId takes priority.`,

  inputSchema: getDirectionsInputSchema,

  anthropicSchema: {
    type: 'object',
    properties: {
      eventId: {
        type: 'string',
        description: 'The ID of the event to get directions to',
      },
      venueId: {
        type: 'string',
        description: 'The ID of the venue to get directions to (use if no event ID)',
      },
    },
  },

  requiresAuth: false,

  execute: async (input, context) => {
    try {
      // Validate that at least one ID is provided
      if (!input.eventId && !input.venueId) {
        return {
          success: false,
          formatted: JSON.stringify({
            error: 'missing_id',
            message: 'I need either an event or venue to get directions. Which event were you asking about?',
          }),
          error: 'missing_id',
        }
      }

      let venueName: string
      let venueAddress: string | null
      let venueNeighborhood: string | null
      let eventName: string | undefined
      let eventId: string | undefined
      let venueId: string | undefined

      // Get venue info from event or directly
      if (input.eventId) {
        const event = await readers.getEventWithVenue(input.eventId, context.abortSignal)
        if (!event) {
          return {
            success: false,
            formatted: JSON.stringify({
              error: 'event_not_found',
              message: "I couldn't find that event. It may have been removed.",
            }),
            error: 'event_not_found',
          }
        }

        if (event.location_hidden || event.location_tba) {
          return {
            success: false,
            formatted: JSON.stringify({ error: 'location_unavailable', message: 'The event location is hidden or not yet confirmed. Check the original source for location details.' }),
            error: 'location_unavailable',
          }
        }

        eventName = event.name
        eventId = event.id
        venueId = event.venue_id ?? undefined
        venueName = event.venue_name || 'Unknown venue'
        venueAddress = event.venue_address
        venueNeighborhood = event.venue_neighborhood
      } else {
        const venue = await readers.getVenueById(input.venueId!, context.abortSignal)
        if (!venue) {
          return {
            success: false,
            formatted: JSON.stringify({
              error: 'venue_not_found',
              message: "I couldn't find that venue.",
            }),
            error: 'venue_not_found',
          }
        }

        venueId = input.venueId
        venueName = venue.name
        venueAddress = venue.address
        venueNeighborhood = venue.neighborhood
      }

      // Check if we have enough info for directions
      if (!venueAddress && !venueNeighborhood) {
        return {
          success: false,
          formatted: JSON.stringify({
            error: 'no_address',
            message: `I don't have an address for ${venueName}. You might need to search for it directly.`,
          }),
          error: 'no_address',
        }
      }

      // Build the address string
      const addressParts = [venueAddress, venueNeighborhood].filter(Boolean)
      const fullAddress = addressParts.join(', ')

      // Generate the Maps URL
      const mapsUrl = generateMapsUrl(fullAddress, venueName)

      console.log(`[DEBUG] get_directions: generated link for "${venueName}"`)

      // Return structured data for the DirectionsCard
      // The LLM will provide a short message, and the card renders the clickable link
      return {
        success: true,
        venueName,
        address: fullAddress,
        mapsUrl,
        eventName,
        directions: {
          venueName,
          address: fullAddress,
          mapsUrl,
          eventName,
          eventId,
          venueId,
        },
        formatted: JSON.stringify({
          success: true,
          venueName,
          address: fullAddress,
          // Don't include mapsUrl in formatted - the LLM shouldn't paste the URL
          message: `I've prepared directions to ${venueName} at ${fullAddress}. You can open them with the button below.`,
        }),
        metadata: {
          venueName,
          hasAddress: !!venueAddress,
        },
      }
    } catch (error) {
      context.abortSignal?.throwIfAborted()
      console.error('[get_directions] Error:', error)
      return {
        success: false,
        formatted: JSON.stringify({ error: 'Failed to generate directions link' }),
        error: 'execution_error',
      }
    }
  },
})

export const getDirectionsTool = createGetDirectionsTool()
