/**
 * Instrumented tool set for the v4 work loop.
 *
 * Builds on `createTools` (existing AI SDK wrappers) and adds:
 * - per-request mutation deduplication so an identical save/unsave is never
 *   re-executed (across parallel calls and across work generations);
 * - two internal, schema-validated, no-side-effect control tools:
 *   `retain_search_results` (reactivate earlier search sources) and
 *   `reject_search_results` (reject one complete prior search stage). Neither
 *   goes through base `createTools` nor touches the database.
 * - pinned-mode tool restriction: broad discovery (`search_events`,
 *   `list_saved_events`) is removed; details/directions/related tools remain.
 */

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import type { UserToolContext } from '../user-tools.server.ts'
import { createTools } from '../tools-ai-sdk.ts'

type ToolObject = { execute: (input: unknown, options?: unknown) => Promise<unknown> }

/**
 * Live view of the in-progress work loop, so the control tools can validate
 * "earlier search stages" structurally (no prose parsing).
 */
export interface RetentionControl {
  /** Index of the work generation currently running. */
  currentStepIndex: number
  /** Completed earlier search stages (stepIndex < current), ascending order. */
  searchStages: Array<{ stepIndex: number; toolCallIds: string[] }>
}

export interface InstrumentedToolOptions {
  userContext: UserToolContext
  locale: 'en' | 'es'
  retention?: RetentionControl
  /** When set, broad discovery tools are removed from the work loop. */
  pinnedEventId?: string
  /** Only true when the latest user request explicitly asks to mutate saved events. */
  allowMutations?: boolean
}

/** Broad discovery tools removed in pinned mode. */
const PINNED_EXCLUDED = new Set(['search_events', 'list_saved_events'])

/** Mutation tools removed when the latest raw user request lacks save/unsave intent. */
const MUTATION_TOOLS = new Set(['save_event', 'unsave_event'])

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false
  return true
}

export function createInstrumentedTools(options: InstrumentedToolOptions): ToolSet {
  const { userContext, locale, retention, pinnedEventId, allowMutations } = options
  const tools = createTools(userContext, locale) as unknown as Record<string, ToolObject>

  // In-flight promises are cached BEFORE awaiting so parallel duplicate
  // save/unsave(eventId) calls share one base execution.
  const memo = new Map<string, Promise<unknown>>()

  for (const name of ['save_event', 'unsave_event'] as const) {
    const entry = tools[name]
    if (!entry) continue
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

  // Internal no-side-effect control tools. Added directly here — never through
  // base `createTools` — so they have no DB surface and no mutation memo.
  tools['retain_search_results'] = tool({
    description:
      'Reactivate earlier search_events results by their exact tool call ids so a later refinement can be ignored. Only earlier (already completed) search sources are valid; current, future, or non-search ids are rejected.',
    inputSchema: z.object({
      sourceToolCallIds: z.array(z.string()).describe('Earlier search tool call ids to reactivate'),
    }),
    execute: async (input) => {
      const ids = (input?.sourceToolCallIds ?? []) as string[]
      const current = retention?.currentStepIndex ?? 0
      const earlierIds = new Set(
        (retention?.searchStages ?? [])
          .filter((s) => s.stepIndex < current)
          .flatMap((s) => s.toolCallIds)
      )
      const invalid = ids.filter((id) => !earlierIds.has(id))
      if (invalid.length > 0) {
        return { success: false, error: 'invalid_retention', retained: [], invalid }
      }
      return { success: true, retained: ids }
    },
  }) as unknown as ToolObject

  tools['reject_search_results'] = tool({
    description:
      'Reject ONE complete prior search stage by its exact sourceToolCallIds (all of that stage, no more, no fewer). A rejected stage is never eligible for selection or retention. Partial, current, future, or non-search ids are rejected.',
    inputSchema: z.object({
      sourceToolCallIds: z.array(z.string()).describe('The exact tool call ids of one prior search stage'),
    }),
    execute: async (input) => {
      const ids = (input?.sourceToolCallIds ?? []) as string[]
      const current = retention?.currentStepIndex ?? 0
      const stage = (retention?.searchStages ?? []).find(
        (s) => s.stepIndex < current && sameSet(s.toolCallIds, ids)
      )
      if (!stage) {
        return { success: false, error: 'invalid_rejection', rejected: [], invalid: ids }
      }
      return { success: true, rejected: ids }
    },
  }) as unknown as ToolObject

  if (pinnedEventId) {
    for (const name of PINNED_EXCLUDED) {
      delete tools[name]
    }
  }

  // Structural mutation gating: save/unsave are unavailable unless the latest
  // raw user request carries explicit save/unsave intent. This ensures an
  // injected event/tool string cannot cause a mutation.
  if (allowMutations !== true) {
    for (const name of MUTATION_TOOLS) {
      delete tools[name]
    }
  }

  return tools as ToolSet
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
  | 'retain_search_results'
  | 'reject_search_results'
