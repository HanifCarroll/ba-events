# Tool Development Guide

This guide explains how to create new tools for the BA Events AI agent using the modular tool registry pattern.

## Architecture Overview

Tools are defined in `src/features/chat/api/tools/` following a registry pattern:

```
tools/
├── index.ts          # Central registry & exports
├── types.ts          # Shared types & defineTool helper
├── utils.ts          # Shared utilities (formatting, timezone)
├── search-events.ts  # Individual tool files
├── save-event.ts
└── ...
```

## Creating a New Tool

### Step 1: Create the Tool File

Create a new file in `src/features/chat/api/tools/` named after your tool (e.g., `my-new-tool.ts`).

```typescript
// tools/my-new-tool.ts
import { z } from 'zod'
import { defineTool } from './types'

// ============================================================================
// INPUT SCHEMA
// ============================================================================

const inputSchema = z.object({
  // Define your tool's input parameters using Zod
  eventId: z.string().describe('The ID of the event'),
  optional: z.boolean().optional().describe('An optional parameter'),
})

export type MyNewToolInput = z.infer<typeof inputSchema>

// ============================================================================
// TOOL DEFINITION
// ============================================================================

export const myNewToolTool = defineTool({
  name: 'my_new_tool',

  description: `Clear description of what this tool does and when to use it.
Include examples of user phrases that should trigger this tool.`,

  inputSchema,

  // JSON Schema for Anthropic API (must match Zod schema)
  anthropicSchema: {
    type: 'object',
    properties: {
      eventId: {
        type: 'string',
        description: 'The ID of the event',
      },
      optional: {
        type: 'boolean',
        description: 'An optional parameter',
      },
    },
    required: ['eventId'],
  },

  // Set to true if this tool requires user authentication
  requiresAuth: false,

  // The execute function receives validated input and context
  execute: async (input, context) => {
    try {
      // Your implementation here
      const result = await doSomething(input.eventId)

      return {
        success: true,
        formatted: JSON.stringify({ data: result }),
        // Include events array if returning event data
        // events: result,
      }
    } catch (error) {
      console.error('[my_new_tool] Error:', error)
      return {
        success: false,
        formatted: JSON.stringify({ error: 'Failed to execute' }),
        error: 'execution_error',
      }
    }
  },
})
```

### Step 2: Register the Tool

Add your tool to the registry in `tools/index.ts`:

```typescript
// Import the tool
import { myNewToolTool } from './my-new-tool'

// Add to the tools record
export const tools = {
  // ... existing tools
  my_new_tool: myNewToolTool,
} as const
```

That's it! The registry automatically:
- Includes the tool in `getAnthropicTools()` for Claude API calls
- Makes it available via `executeTool(name, input, context)`
- Validates input with your Zod schema before execution

### Step 3: Update the System Prompt (if needed)

If your tool requires special instructions for Claude, update the prompt in `prompts/concierge-v1.ts`:

```typescript
## Your New Tool

**my_new_tool** - Description of the tool
- Use when: user says X, Y, or Z
- Returns: what it returns
```

## Tool Definition Properties

| Property | Required | Description |
|----------|----------|-------------|
| `name` | Yes | Snake_case tool name (e.g., `search_events`) |
| `description` | Yes | Clear description for Claude. Include trigger phrases. |
| `inputSchema` | Yes | Zod schema for input validation |
| `anthropicSchema` | Yes | JSON Schema for Anthropic API |
| `requiresAuth` | Yes | Boolean - does this tool need an authenticated user? |
| `execute` | Yes | Async function `(input, context) => Promise<ToolResult>` |

## Execution Context

The `execute` function receives a `ToolExecutionContext`:

```typescript
interface ToolExecutionContext {
  userContext: {
    userId: string | null
    supabase: SupabaseClient  // Authenticated client
  }
  locale: 'en' | 'es'
}
```

## Tool Result Format

Tools must return a `ToolResult`:

```typescript
interface ToolResult {
  success: boolean
  formatted: string           // JSON string for Claude
  events?: EventWithVenue[]   // Optional: events to display as cards
  error?: string              // Optional: error code if failed
  metadata?: Record<string, unknown>  // Optional: extra data
}
```

## Authentication Pattern

For tools that require authentication:

```typescript
export const myAuthToolTool = defineTool({
  // ...
  requiresAuth: true,

  execute: async (input, context) => {
    // Check authentication
    if (!context.userContext.userId) {
      return {
        success: false,
        formatted: JSON.stringify({
          error: 'auth_required',
          message: 'You need to be signed in to use this feature.',
        }),
        error: 'auth_required',
      }
    }

    // Proceed with authenticated operation
    const { supabase, userId } = context.userContext
    // ...
  },
})
```

## Shared Utilities

Import common utilities from `./utils`:

```typescript
import {
  getNowInBA,           // Get current time in Buenos Aires
  baToUTC,              // Convert BA time to UTC
  formatInBA,           // Format date for BA timezone
  formatEventsToolResult, // Format events for Claude
} from './utils'
```

## Testing Your Tool

1. **TypeScript check**: `bunx tsc --noEmit`
2. **Manual testing**: Use the chat interface to trigger your tool
3. **Check logs**: Look for `[tool_name]` prefixed logs in the console

## Best Practices

1. **Descriptive tool names**: Use snake_case, be specific (e.g., `list_saved_events` not `get_list`)

2. **Clear descriptions**: Include trigger phrases Claude should recognize:
   ```typescript
   description: 'Save an event to the user\'s list. Use when user says "save that", "I want to go", "bookmark it".'
   ```

3. **Validate early**: Use Zod schemas to catch invalid input before execution

4. **Handle errors gracefully**: Return structured error responses, don't throw

5. **Log with context**: Prefix logs with tool name for debugging:
   ```typescript
   console.log('[my_tool] Processing event:', eventId)
   ```

6. **Keep tools atomic**: One tool = one action. Complex features emerge from combining tools.

## Example: Complete Tool Implementation

See `tools/check-event-saved.ts` for a simple, well-documented example:

```typescript
import { z } from 'zod'
import { defineTool } from './types'

const inputSchema = z.object({
  eventId: z.string().describe('The ID of the event to check'),
})

export type CheckEventSavedInput = z.infer<typeof inputSchema>

export const checkEventSavedTool = defineTool({
  name: 'check_event_saved',

  description: `Check if an event is already saved to the user's list.
Returns isSaved: true/false. Use proactively when showing events.`,

  inputSchema,

  anthropicSchema: {
    type: 'object',
    properties: {
      eventId: {
        type: 'string',
        description: 'The ID of the event to check',
      },
    },
    required: ['eventId'],
  },

  requiresAuth: true,

  execute: async (input, context) => {
    if (!context.userContext.userId) {
      return {
        success: false,
        formatted: JSON.stringify({
          error: 'auth_required',
          message: 'Sign in to check your saved events.',
        }),
        error: 'auth_required',
      }
    }

    const { supabase, userId } = context.userContext

    const { data } = await supabase
      .from('saved_events')
      .select('id')
      .eq('user_id', userId)
      .eq('event_id', input.eventId)
      .single()

    return {
      success: true,
      formatted: JSON.stringify({
        eventId: input.eventId,
        isSaved: !!data,
      }),
    }
  },
})
```

## Adding Tools Checklist

- [ ] Create tool file in `tools/`
- [ ] Define Zod input schema
- [ ] Define matching Anthropic JSON schema
- [ ] Implement execute function with error handling
- [ ] Add to registry in `tools/index.ts`
- [ ] Update system prompt if needed (`prompts/concierge-v1.ts`)
- [ ] Run `bunx tsc --noEmit` to verify types
- [ ] Test manually via chat interface
- [ ] Update `docs/agent-native-architecture.md` parity table if closing a gap
