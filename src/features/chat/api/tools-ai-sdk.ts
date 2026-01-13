/**
 * AI SDK Tool Wrappers
 *
 * This file wraps the existing tool definitions in AI SDK's `tool()` format.
 * The existing Zod schemas are reused directly, and the execute functions
 * are wrapped to pass the context via closure.
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
import { getHappeningNowInputSchema, getHappeningNowTool } from './tools/get-happening-now'
import { getTonightsEventsInputSchema, getTonightsEventsTool } from './tools/get-tonights-events'
import { getUserContextInputSchema, getUserContextTool } from './tools/get-user-context'
import { getEventStatsInputSchema, getEventStatsTool } from './tools/get-event-stats'
import { listNeighborhoodsInputSchema, listNeighborhoodsWithEventsTool } from './tools/list-neighborhoods-with-events'
import { listCategoriesInputSchema, listCategoriesWithEventsTool } from './tools/list-categories-with-events'
import { shareEventInputSchema, shareEventTool } from './tools/share-event'
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

    get_happening_now: tool({
      description: getHappeningNowTool.description,
      inputSchema: getHappeningNowInputSchema,
      execute: async (input) => getHappeningNowTool.execute(input, context),
    }),

    get_tonights_events: tool({
      description: getTonightsEventsTool.description,
      inputSchema: getTonightsEventsInputSchema,
      execute: async (input) => getTonightsEventsTool.execute(input, context),
    }),

    get_user_context: tool({
      description: getUserContextTool.description,
      inputSchema: getUserContextInputSchema,
      execute: async (input) => getUserContextTool.execute(input, context),
    }),

    get_event_stats: tool({
      description: getEventStatsTool.description,
      inputSchema: getEventStatsInputSchema,
      execute: async (input) => getEventStatsTool.execute(input, context),
    }),

    list_neighborhoods_with_events: tool({
      description: listNeighborhoodsWithEventsTool.description,
      inputSchema: listNeighborhoodsInputSchema,
      execute: async (input) => listNeighborhoodsWithEventsTool.execute(input, context),
    }),

    list_categories_with_events: tool({
      description: listCategoriesWithEventsTool.description,
      inputSchema: listCategoriesInputSchema,
      execute: async (input) => listCategoriesWithEventsTool.execute(input, context),
    }),

    share_event: tool({
      description: shareEventTool.description,
      inputSchema: shareEventInputSchema,
      execute: async (input) => shareEventTool.execute(input, context),
    }),

    get_directions: tool({
      description: getDirectionsTool.description,
      inputSchema: getDirectionsInputSchema,
      execute: async (input) => getDirectionsTool.execute(input, context),
    }),
  }
}

/**
 * Type for all available tool names
 */
export type AISDKToolName = keyof ReturnType<typeof createTools>
