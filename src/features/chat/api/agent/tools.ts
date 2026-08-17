/**
 * Instrumented tool set for the v3 work loop.
 *
 * Builds on `createTools` (existing AI SDK wrappers) and adds per-request
 * mutation deduplication so an identical save/unsave is never re-executed —
 * including when the model repeats a call across work generations or when
 * finalization/persistence later fails. The first execution's result is cached
 * by `toolName:eventId` and returned verbatim for every duplicate.
 */

import type { ToolSet } from 'ai'
import type { UserToolContext } from '../user-tools.server.ts'
import { createTools } from '../tools-ai-sdk.ts'

type ToolObject = { execute: (input: unknown, options?: unknown) => Promise<unknown> }

export function createInstrumentedTools(
  userContext: UserToolContext,
  locale: 'en' | 'es'
): ToolSet {
  const tools = createTools(userContext, locale)
  // In-flight promises are cached BEFORE awaiting so parallel duplicate
  // save/unsave(eventId) calls share one base execution.
  const memo = new Map<string, Promise<unknown>>()

  for (const name of ['save_event', 'unsave_event'] as const) {
    const entry = tools[name] as unknown as ToolObject
    const original = entry.execute
    entry.execute = (input: unknown, options?: unknown) => {
      const eventId =
        input && typeof input === 'object' && typeof (input as { eventId?: unknown }).eventId === 'string'
          ? (input as { eventId: string }).eventId
          : ''
      const key = `${name}:${eventId}`
      const inFlight = memo.get(key)
      if (inFlight) return inFlight
      const result = original.call(entry, input, options)
      memo.set(key, result)
      return result
    }
  }

  return tools
}

export type InstrumentedToolName =
  | 'search_events'
  | 'get_venue_details'
  | 'save_event'
  | 'unsave_event'
  | 'list_saved_events'
  | 'get_event_details'
  | 'check_event_saved'
  | 'get_directions'
