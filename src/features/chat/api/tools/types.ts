/**
 * Tool Registry Types
 *
 * Defines the shared types and helpers for the modular tool system.
 * Each tool uses the `defineTool` helper to ensure type safety.
 */

import { z } from 'zod'
import type { UserToolContext } from '../user-tools'
import type { ChatEventPayload } from '@/shared/lib/types'

// ============================================================================
// CONTEXT TYPES
// ============================================================================

/**
 * Context passed to every tool execution.
 * Contains user auth context and locale information.
 */
export interface ToolExecutionContext {
  /** User authentication context from session */
  userContext: UserToolContext
  /** Current locale for response formatting */
  locale: 'en' | 'es'
}

// ============================================================================
// RESULT TYPES
// ============================================================================

/**
 * Standard result shape returned by all tools.
 * The `formatted` field is what gets sent to Claude as tool_result content.
 */
export interface ToolResult {
  /** Whether the tool execution succeeded */
  success: boolean
  /** Events to display in the UI (optional) */
  events?: ChatEventPayload[]
  /** JSON string sent to Claude as tool result */
  formatted: string
  /** Error message if success is false */
  error?: string
  /** Additional metadata for analytics */
  metadata?: Record<string, unknown>
}

// ============================================================================
// TOOL DEFINITION
// ============================================================================

/**
 * JSON Schema type for Anthropic API.
 * This matches Anthropic's expected input_schema format.
 */
export interface AnthropicInputSchema {
  type: 'object'
  properties: Record<string, {
    type: string
    description?: string
    enum?: string[]
    items?: { type: string }
  }>
  required?: string[]
}

/**
 * Complete tool definition with schema, description, and execute function.
 *
 * @template TInput - Zod schema type for input validation
 */
export interface ToolDefinition<TInput extends z.ZodTypeAny = z.ZodTypeAny> {
  /** Unique tool name (snake_case) */
  name: string
  /** Description shown to Claude - should explain when/how to use the tool */
  description: string
  /** Zod schema for runtime input validation */
  inputSchema: TInput
  /** JSON Schema for Anthropic API */
  anthropicSchema: AnthropicInputSchema
  /** Whether this tool requires user authentication */
  requiresAuth: boolean
  /** Execute the tool with validated input */
  execute: (input: z.infer<TInput>, context: ToolExecutionContext) => Promise<ToolResult>
}

/**
 * Helper function to define a tool with full type inference.
 * Ensures the tool definition matches the expected shape.
 *
 * @example
 * ```typescript
 * export const myTool = defineTool({
 *   name: 'my_tool',
 *   description: 'Does something useful',
 *   inputSchema: z.object({ query: z.string() }),
 *   anthropicSchema: { type: 'object', properties: { query: { type: 'string' } } },
 *   requiresAuth: false,
 *   execute: async (input, context) => {
 *     return { success: true, formatted: JSON.stringify({ result: 'done' }) }
 *   }
 * })
 * ```
 */
export function defineTool<TInput extends z.ZodTypeAny>(
  definition: ToolDefinition<TInput>
): ToolDefinition<TInput> {
  return definition
}

// ============================================================================
// TOOL NAME TYPE (populated by registry)
// ============================================================================

/**
 * Union type of all tool names.
 * This is re-exported from the registry after all tools are registered.
 */
export type ToolName =
  | 'search_events'
  | 'get_venue_details'
  | 'save_event'
  | 'unsave_event'
  | 'list_saved_events'
  | 'get_event_details'
  | 'check_event_saved'
  | 'get_happening_now'
  | 'get_tonights_events'
