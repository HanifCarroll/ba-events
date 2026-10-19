#!/usr/bin/env bun
/**
 * Agent runner for evals.
 *
 * Mirrors src/routes/api/chat/+server.ts: bounded DATA history + rehydrated
 * state -> ToolLoopAgent read loop -> canonical response, running against the
 * real DeepSeek model and dev database with an anonymous user context.
 */
import { generateId } from 'ai'
import { runSharedChatTurn, type SharedChatTurnInput, type SharedChatTurnDependencies } from '#features/chat/api/agent/shared-turn.server.ts'
import type { UserToolContext } from '#features/chat/api/user-tools.server.ts'
import type { CanonicalChatResponse } from '#shared/lib/types.ts'
import type { ModelEvidence } from '../concierge/quality.ts'

const ANON_CONTEXT: UserToolContext = { userId: null, isAuthenticated: false }

export interface AgentToolCall {
  toolName: string
  input: Record<string, unknown>
  eventIds: string[]
}

export interface AgentRun {
  text: string
  toolCalls: AgentToolCall[]
  /** Displayed events from the canonical response. */
  events: CanonicalChatResponse['events']
  stepCount: number
  canonical: CanonicalChatResponse
  /** True when every displayed event is grounded by its credited source read. */
  cardsGrounded: boolean
  /** Eval-only model-visible evidence; never persisted by the application. */
  modelEvidence?: ModelEvidence
  timing?: { transport: 'stream'; firstUsefulMs: number | null; firstGroundedTextMs?: number | null; completionMs: number }
}

export type ConciergeEvalContext = Pick<SharedChatTurnInput,
  'priorHints' | 'recentMessages' | 'lastSearch' | 'homeEventIds' | 'pin' | 'pinFacts' | 'sessionId'
> & { currentDateInBA?: string; capturePerformance?: boolean }

export async function runConcierge(
  message: string,
  locale: 'en' | 'es',
  context: Partial<ConciergeEvalContext> = {},
  dependencies: SharedChatTurnDependencies = {},
): Promise<AgentRun> {
  const { currentDateInBA, capturePerformance, ...turnContext } = context
  const started = performance.now()
  let firstUsefulMs: number | null = null
  let firstGroundedTextMs: number | null = null
  const observeProgress = (response: CanonicalChatResponse) => {
    if (firstGroundedTextMs === null && response.text.trim() &&
      (response.provenance.sourceToolCallIds.length || response.directions || response.venue || response.clarificationQuestions.length)) {
      firstGroundedTextMs = Math.round(performance.now() - started)
    }
    if (firstUsefulMs !== null) return
    if (response.events.length || response.directions || response.venue ||
      response.kind === 'clarification' && response.clarificationQuestions.length) {
      firstUsefulMs = Math.round(performance.now() - started)
    }
  }
  const result = await runSharedChatTurn({
    requestId: generateId(),
    userContext: ANON_CONTEXT,
    locale,
    text: message,
    priorHints: [],
    ...turnContext,
    channel: 'eval',
    ...(capturePerformance ? { onProgress: observeProgress } : {}),
  }, { ...dependencies, ...(currentDateInBA ? { currentDateInBA } : {}) })

  if (capturePerformance) observeProgress(result.canonical)
  const completionMs = Math.round(performance.now() - started)

  const toolCalls: AgentToolCall[] = result.reads.map((r) => ({
    toolName: r.toolName,
    input: (r.input ?? {}) as Record<string, unknown>,
    eventIds: r.eventIds,
  }))

  const sourceIds = new Set(result.canonical.provenance.sourceToolCallIds)
  const cardsGrounded = result.canonical.events.every((event) =>
    result.reads.some(
      (read) =>
        read.success &&
        sourceIds.has(read.toolCallId) &&
        read.eventIds.includes(event.id)
    )
  )

  return {
    text: result.canonical.text ?? '',
    toolCalls,
    events: result.canonical.events,
    stepCount: result.executionTrace.length,
    canonical: result.canonical,
    cardsGrounded,
    ...(capturePerformance ? { timing: { transport: 'stream' as const, firstUsefulMs, firstGroundedTextMs, completionMs } } : {}),
  }
}
