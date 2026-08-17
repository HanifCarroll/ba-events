/**
 * Instrumented tool set for the v5 work loop.
 *
 * Builds on `createTools` (existing AI SDK wrappers) and adds two internal,
 * schema-validated, no-side-effect control tools: `retain_search_results`
 * (reactivate earlier search sources) and `reject_search_results` (reject one
 * complete prior search stage). Neither goes through base `createTools` nor
 * touches the database.
 *
 * v5: `save_event`/`unsave_event` are NEVER part of the work loop. Mutations
 * are planned and executed deterministically AFTER finalizer validation (see
 * `mutation.ts`), so the work loop cannot run an unrestricted save/unsave
 * against a model-supplied event id. `createTools` is injectable so tests do
 * not depend on Vitest `vi.mock`.
 */

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import type { UserToolContext } from '../user-tools.server.ts'
import { createTools } from '../tools-ai-sdk.ts'

type ToolObject = { execute: (input: unknown, options?: unknown) => Promise<unknown> }

/** Injectable base-tool factory (defaults to the real AI SDK wrappers). */
export type CreateToolsFn = (
  userContext: UserToolContext,
  locale: 'en' | 'es'
) => Record<string, ToolObject>

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
  /** Injectable base-tool factory (test seam; defaults to the real `createTools`). */
  createToolsFn?: CreateToolsFn
}

/** Broad discovery tools removed in pinned mode. */
const PINNED_EXCLUDED = new Set(['search_events', 'list_saved_events'])

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false
  return true
}

export function createInstrumentedTools(options: InstrumentedToolOptions): ToolSet {
  const { userContext, locale, retention, pinnedEventId, createToolsFn } = options
  const tools = (createToolsFn ?? createTools)(userContext, locale) as unknown as Record<
    string,
    ToolObject
  >

  // v5: save/unsave are never available in the work loop. The deterministic
  // post-plan mutation executor (mutation.ts) is the only mutation surface.
  delete tools['save_event']
  delete tools['unsave_event']

  // Internal no-side-effect control tools. Added directly here — never through
  // base `createTools` — so they have no DB surface.
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

  return tools as ToolSet
}

export type InstrumentedToolName =
  | 'search_events'
  | 'get_venue_details'
  | 'list_saved_events'
  | 'get_event_details'
  | 'check_event_saved'
  | 'get_directions'
  | 'retain_search_results'
  | 'reject_search_results'
