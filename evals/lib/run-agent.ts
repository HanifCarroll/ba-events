#!/usr/bin/env bun
/**
 * Agent runner for evals.
 *
 * Mirrors src/routes/api/chat/+server.ts: the manual work loop + no-tools
 * finalizer + deterministic validation/fallback, running against the real
 * DeepSeek model and dev database with an anonymous user context.
 */
import { generateId } from 'ai'
import { getSystemPrompt } from '#features/chat/api/prompts/index.ts'
import { orchestrate } from '#features/chat/api/agent/orchestrate.ts'
import { resolveTurnTargetFromQuery } from '#features/chat/api/agent/context.ts'
import type { UserToolContext } from '#features/chat/api/user-tools.server.ts'
import type { CanonicalChatResponse } from '#shared/lib/types.ts'

const ANON_CONTEXT: UserToolContext = { userId: null, isAuthenticated: false }

export interface AgentToolCall {
  toolName: string
  input: Record<string, unknown>
}

export interface AgentRun {
  text: string
  toolCalls: AgentToolCall[]
  /** Displayed events from the canonical response. */
  events: CanonicalChatResponse['events']
  stepCount: number
  canonical: CanonicalChatResponse
  /**
   * True when every canonical event appears in at least one successful
   * current-request ledger artifact whose toolCallId is in
   * `canonical.provenance.sourceToolCallIds`. Non-tautological grounding
   * check (differs from comparing events against themselves).
   */
  cardsGrounded: boolean
}

export async function runConcierge(message: string, locale: 'en' | 'es'): Promise<AgentRun> {
  // Mirror +server.ts: a single clause-aware turn target authoritative for
  // mutation/directions/venue. No prior context in evals, so prior ids are absent.
  const { turnTarget, mutationIntent } = resolveTurnTargetFromQuery({
    query: message,
    groups: [],
  })

  const result = await orchestrate({
    requestId: generateId(),
    modelMessages: [{ role: 'user', content: message }],
    userContext: ANON_CONTEXT,
    locale,
    systemPrompt: getSystemPrompt({ isAuthenticated: false, savedEventsCount: 0 }),
    originalQuery: message,
    priorDisplayedEvents: [],
    mutationIntent,
    turnTarget,
  })

  const toolCalls: AgentToolCall[] = result.ledger
    .all()
    .filter((e) => e.kind !== 'tool-error')
    .map((e) => ({
      toolName: e.toolName,
      input: (e.input ?? {}) as Record<string, unknown>,
    }))

  const maxStep = result.ledger.all().reduce((m, e) => Math.max(m, e.stepIndex), -1)

  // Grounding: every displayed card must trace to a successful current-request
  // ledger artifact that the canonical provenance actually credits as its source.
  const sourceIds = new Set(result.canonical.provenance.sourceToolCallIds)
  const cardsGrounded = result.canonical.events.every((ev) =>
    result.ledger.all().some(
      (entry) =>
        entry.success &&
        sourceIds.has(entry.toolCallId) &&
        entry.events.some((e) => e.id === ev.id)
    )
  )

  return {
    text: result.canonical.text ?? '',
    toolCalls,
    events: result.canonical.events,
    stepCount: maxStep + 1,
    canonical: result.canonical,
    cardsGrounded,
  }
}
