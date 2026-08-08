/**
 * Tool Registry
 *
 * Central registry for all agent tools. Provides:
 * - Typed tool definitions
 * - Tool execution by name
 * - Auto-discovery of all registered tools
 */

import type { ToolDefinition, ToolExecutionContext, ToolResult, ToolName } from './types'

// Import all tools
import { searchEventsTool } from './search-events'
import { getVenueDetailsTool } from './get-venue-details'
import { saveEventTool } from './save-event'
import { unsaveEventTool } from './unsave-event'
import { listSavedEventsTool } from './list-saved-events'
import { getEventDetailsTool } from './get-event-details'
import { checkEventSavedTool } from './check-event-saved'
import { getHappeningNowTool } from './get-happening-now'
import { getTonightsEventsTool } from './get-tonights-events'
import { getUserContextTool } from './get-user-context'
import { getEventStatsTool } from './get-event-stats'
import { listNeighborhoodsWithEventsTool } from './list-neighborhoods-with-events'
import { listCategoriesWithEventsTool } from './list-categories-with-events'
import { shareEventTool } from './share-event'
import { getDirectionsTool } from './get-directions'

// Re-export types
export type { ToolDefinition, ToolExecutionContext, ToolResult, ToolName } from './types'
export type { SearchEventsInput } from './search-events'

// Re-export utilities
export { formatEventsToolResult, formatInBA, getNowInBA, baToUTC } from './utils'

// ============================================================================
// TOOL REGISTRY
// ============================================================================

/**
 * All registered tools as a typed record.
 * The key is the tool name, the value is the tool definition.
 */
export const tools = {
  search_events: searchEventsTool,
  get_venue_details: getVenueDetailsTool,
  save_event: saveEventTool,
  unsave_event: unsaveEventTool,
  list_saved_events: listSavedEventsTool,
  get_event_details: getEventDetailsTool,
  check_event_saved: checkEventSavedTool,
  get_happening_now: getHappeningNowTool,
  get_tonights_events: getTonightsEventsTool,
  get_user_context: getUserContextTool,
  get_event_stats: getEventStatsTool,
  list_neighborhoods_with_events: listNeighborhoodsWithEventsTool,
  list_categories_with_events: listCategoriesWithEventsTool,
  share_event: shareEventTool,
  get_directions: getDirectionsTool,
} as const

/**
 * Array of all tool names for iteration.
 */
export const toolNames = Object.keys(tools) as ToolName[]

// ============================================================================
// TOOL LOOKUP & EXECUTION
// ============================================================================

/**
 * Get a tool definition by name.
 * Returns undefined if tool doesn't exist.
 */
export function getTool(name: string): ToolDefinition | undefined {
  return tools[name as ToolName]
}

/**
 * Check if a tool name is valid.
 */
export function isValidToolName(name: string): name is ToolName {
  return name in tools
}

/**
 * Execute a tool by name with the given input.
 *
 * @param name - Tool name
 * @param input - Raw input from Claude (will be validated with Zod)
 * @param context - Execution context (user auth, locale)
 * @returns Tool result with formatted output for Claude
 *
 * @throws Error if tool doesn't exist
 * @throws ZodError if input validation fails
 */
export async function executeTool(
  name: string,
  input: unknown,
  context: ToolExecutionContext
): Promise<ToolResult> {
  const tool = getTool(name)

  if (!tool) {
    console.error(`[Tool Registry] Unknown tool: ${name}`)
    return {
      success: false,
      formatted: JSON.stringify({ error: `Unknown tool: ${name}` }),
      error: 'unknown_tool',
    }
  }

  try {
    // Validate input with Zod schema
    const validatedInput = tool.inputSchema.parse(input)

    // Execute the tool
    return await tool.execute(validatedInput, context)
  } catch (error) {
    // Handle Zod validation errors
    if (error && typeof error === 'object' && 'issues' in error) {
      console.error(`[Tool Registry] Validation error for ${name}:`, error)
      return {
        success: false,
        formatted: JSON.stringify({
          error: 'Invalid input',
          details: (error as { issues: unknown[] }).issues,
        }),
        error: 'validation_error',
      }
    }

    // Re-throw unexpected errors
    throw error
  }
}

// ============================================================================
// TOOL METADATA
// ============================================================================

/**
 * Get metadata about all tools.
 * Useful for debugging and documentation.
 */
export function getToolMetadata() {
  return Object.entries(tools).map(([name, tool]) => ({
    name,
    description: tool.description,
    requiresAuth: tool.requiresAuth,
  }))
}

/**
 * Get tools that require authentication.
 */
export function getAuthRequiredTools(): ToolName[] {
  return toolNames.filter(name => tools[name].requiresAuth)
}
