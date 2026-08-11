#!/usr/bin/env bun
/**
 * Agent runner for evals.
 *
 * Mirrors src/routes/api/chat.ts model setup: same system prompt, same tools,
 * same NO_THINKING + step cap. Runs against the real dev database with an
 * anonymous user context (read-only search tools only).
 */
import { generateText, stepCountIs } from 'ai'
import { getSystemPrompt } from '@/features/chat/api/prompts'
import { createTools } from '@/features/chat/api/tools-ai-sdk'
import { NO_THINKING, textModel } from '@/shared/lib/ai/providers'
import type { UserToolContext } from '@/features/chat/api/user-tools'
import type { ChatEventPayload } from '@/shared/lib/types'

const MAX_STEPS = 3 // mirrors src/routes/api/chat.ts

const ANON_CONTEXT: UserToolContext = { userId: null, isAuthenticated: false }

export interface AgentToolCall {
  toolName: string
  input: Record<string, unknown>
}

export interface AgentRun {
  text: string
  toolCalls: AgentToolCall[]
  /** Union of events returned by any tool, keyed by id */
  events: ChatEventPayload[]
  stepCount: number
}

export async function runConcierge(message: string, locale: 'en' | 'es'): Promise<AgentRun> {
  const result = await generateText({
    model: textModel,
    system: getSystemPrompt({ isAuthenticated: false, savedEventsCount: 0 }),
    messages: [{ role: 'user', content: message }],
    tools: createTools(ANON_CONTEXT, locale),
    ...NO_THINKING,
    stopWhen: stepCountIs(MAX_STEPS),
  })

  const toolCalls: AgentToolCall[] = []
  const events = new Map<string, ChatEventPayload>()

  for (const step of result.steps) {
    for (const call of step.toolCalls) {
      toolCalls.push({
        toolName: call.toolName,
        input: (call.input ?? {}) as Record<string, unknown>,
      })
    }
    for (const tr of step.toolResults) {
      const output = tr.output as { events?: ChatEventPayload[] } | undefined
      if (output?.events) {
        for (const e of output.events) events.set(e.id, e)
      }
    }
  }

  return {
    text: result.text ?? '',
    toolCalls,
    events: [...events.values()],
    stepCount: result.steps.length,
  }
}
