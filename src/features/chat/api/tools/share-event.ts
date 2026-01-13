/**
 * share_event Tool
 *
 * Generates a shareable link for an event.
 * Returns a URL the user can send to friends.
 */

import { z } from 'zod'
import { defineTool } from './types'
import { getEventWithVenue } from '@/shared/lib/db/client'

// ============================================================================
// INPUT SCHEMA
// ============================================================================

export const shareEventInputSchema = z.object({
  eventId: z.string().describe('The ID of the event to share'),
})

export type ShareEventInput = z.infer<typeof shareEventInputSchema>

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const shareEventTool = defineTool({
  name: 'share_event',

  description: `Generate a shareable link for an event.
Use when the user asks to share an event: "share this", "send this to a friend", "get link", "copy link".
Returns a URL they can copy and share.`,

  inputSchema: shareEventInputSchema,

  anthropicSchema: {
    type: 'object',
    properties: {
      eventId: {
        type: 'string',
        description: 'The ID of the event to share',
      },
    },
    required: ['eventId'],
  },

  requiresAuth: false,

  execute: async (input) => {
    try {
      // Get the event to include name in response
      const event = await getEventWithVenue(input.eventId)

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

      // Generate the shareable URL
      // Using the app's event detail page - this assumes we have an event detail route
      const baseUrl = process.env.VITE_APP_URL || 'https://buenosaires.events'
      const shareUrl = `${baseUrl}/events/${input.eventId}`

      const result = {
        success: true,
        eventId: input.eventId,
        eventName: event.name,
        shareUrl,
        message: `Here's the link to share: ${shareUrl}`,
      }

      console.log(`[DEBUG] share_event: generated link for "${event.name}"`)

      return {
        success: true,
        formatted: JSON.stringify(result),
        metadata: {
          eventId: input.eventId,
          eventName: event.name,
        },
      }
    } catch (error) {
      console.error('[share_event] Error:', error)
      return {
        success: false,
        formatted: JSON.stringify({ error: 'Failed to generate share link' }),
        error: 'execution_error',
      }
    }
  },
})
