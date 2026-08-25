#!/usr/bin/env bun
/**
 * Agent runner for evals.
 *
 * Mirrors src/routes/api/chat/+server.ts: bounded DATA history + rehydrated
 * state -> ToolLoopAgent read loop -> canonical response, running against the
 * real DeepSeek model and dev database with an anonymous user context.
 */
import { generateId } from 'ai'
import { orchestrate } from '#features/chat/api/agent/orchestrate.ts'
import type { UserToolContext } from '#features/chat/api/user-tools.server.ts'
import type { CanonicalChatResponse } from '#shared/lib/types.ts'

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
}

export async function runConcierge(message: string, locale: 'en' | 'es'): Promise<AgentRun> {
  const result = await orchestrate({
    requestId: generateId(),
    userContext: ANON_CONTEXT,
    locale,
    originalQuery: message,
    priorDisplayedEvents: [],
  })

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
    stepCount: result.reads.length,
    canonical: result.canonical,
    cardsGrounded,
  }
}
