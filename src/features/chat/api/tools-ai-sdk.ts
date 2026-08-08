/**
 * AI SDK Tool Wrappers
 *
 * This file wraps the existing tool definitions in AI SDK's `tool()` format.
 * The existing Zod schemas are reused directly, and the execute functions
 * are wrapped to pass the context via closure.
 *
 * All event discovery goes through search_events - including "tonight" and
 * "right now" asks (timeFilter) - so the model has exactly one retrieval
 * surface to choose.
 */

import { tool } from 'ai'
import type { UserToolContext } from './user-tools'

// Import all tool definitions and their input schemas
import { searchEventsInputSchema, searchEventsTool } from './tools/search-events'
import { getVenueDetailsInputSchema, getVenueDetailsTool } from './tools/get-venue-details'
import { saveEventInputSchema, saveEventTool } from './tools/save-event'
import { unsaveEventInputSchema, unsaveEventTool } from './tools/unsave-event'
import { listSavedEventsInputSchema, listSavedEventsTool } from './tools/list-saved-events'
import { getEventDetailsInputSchema, getEventDetailsTool } from './tools/get-event-details'
import { checkEventSavedInputSchema, checkEventSavedTool } from './tools/check-event-saved'
import { getDirectionsInputSchema, getDirectionsTool } from './tools/get-directions'

/**
 * Create all tools with the given user context and locale.
 * Context is passed to tool execute functions via closure.
 */
export function createTools(userContext: UserToolContext, locale: 'en' | 'es') {
  const context = { userContext, locale }

  return {
    search_events: tool({
      description: searchEventsTool.description,
      inputSchema: searchEventsInputSchema,
      execute: async (input) => searchEventsTool.execute(input, context),
    }),

    get_venue_details: tool({
      description: getVenueDetailsTool.description,
      inputSchema: getVenueDetailsInputSchema,
      execute: async (input) => getVenueDetailsTool.execute(input, context),
    }),

    save_event: tool({
      description: saveEventTool.description,
      inputSchema: saveEventInputSchema,
      execute: async (input) => saveEventTool.execute(input, context),
    }),

    unsave_event: tool({
      description: unsaveEventTool.description,
      inputSchema: unsaveEventInputSchema,
      execute: async (input) => unsaveEventTool.execute(input, context),
    }),

    list_saved_events: tool({
      description: listSavedEventsTool.description,
      inputSchema: listSavedEventsInputSchema,
      execute: async (input) => listSavedEventsTool.execute(input, context),
    }),

    get_event_details: tool({
      description: getEventDetailsTool.description,
      inputSchema: getEventDetailsInputSchema,
      execute: async (input) => getEventDetailsTool.execute(input, context),
    }),

    check_event_saved: tool({
      description: checkEventSavedTool.description,
      inputSchema: checkEventSavedInputSchema,
      execute: async (input) => checkEventSavedTool.execute(input, context),
    }),

    get_directions: tool({
      description: getDirectionsTool.description,
      inputSchema: getDirectionsInputSchema,
      execute: async (input) => getDirectionsTool.execute(input, context),
    }),
  }
}

/**
 * All available tool names.
 */
export type AISDKToolName =
  | 'search_events'
  | 'get_venue_details'
  | 'save_event'
  | 'unsave_event'
  | 'list_saved_events'
  | 'get_event_details'
  | 'check_event_saved'
  | 'get_directions'
