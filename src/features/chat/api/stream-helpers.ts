/**
 * Stream helpers extracted from the legacy chat API route.
 *
 * These pure helpers (and the private utilities they depend on) were lifted out
 * of `src/routes/api/chat.ts` so the route handler (ported separately by card
 * A1) and tests can share them. Behavior is unchanged from the legacy route.
 */

import type { UIMessage } from 'ai'
import {
  extractVisibleTextFromStepTexts,
  extractVisibleTextFromUIMessageParts,
} from '#features/chat/lib/extract-visible-text.ts'
import type {
  ChatEventPayload,
  ChatStreamDataEnvelope,
  Json,
  MessageExecutionStep,
} from '#shared/lib/types.ts'

// Agent loop configuration (reduced from 5 for faster responses)
export const MAX_STEPS = 3

export type StepResultLike = {
  stepType?: string
  text?: string
  finishReason?: string
  toolCalls?: Array<{
    toolCallId?: string
    toolName?: string
    input?: unknown
  }>
  toolResults?: Array<{
    toolCallId?: string
    toolName?: string
    input?: unknown
    output?: unknown
  }>
}

export function toJsonSafe(value: unknown): Json | null {
  if (value === undefined) return null

  try {
    return JSON.parse(
      JSON.stringify(value, (key, inner) => {
        if (key === 'embedding') return undefined
        if (typeof inner === 'bigint') return Number(inner)
        return inner
      })
    ) as Json
  } catch {
    return null
  }
}

export function inferToolResultSuccess(output: unknown): boolean {
  if (output && typeof output === 'object' && 'success' in output) {
    const success = (output as { success?: unknown }).success
    if (typeof success === 'boolean') return success
  }
  return true
}

export function normalizeStepType(stepType: unknown): MessageExecutionStep['stepType'] {
  if (stepType === 'initial' || stepType === 'continue' || stepType === 'tool-result') {
    return stepType
  }
  return 'unknown'
}

export function buildExecutionTrace(steps: StepResultLike[]): MessageExecutionStep[] {
  return steps.map((step, index) => ({
    stepIndex: index,
    stepType: normalizeStepType(step.stepType),
    text: step.text ?? '',
    finishReason: step.finishReason ?? 'unknown',
    toolCalls: (step.toolCalls ?? []).map((call) => ({
      toolCallId: call.toolCallId ?? '',
      toolName: call.toolName ?? 'unknown',
      input: toJsonSafe(call.input),
    })),
    toolResults: (step.toolResults ?? []).map((result) => ({
      toolCallId: result.toolCallId ?? '',
      toolName: result.toolName ?? 'unknown',
      input: toJsonSafe(result.input),
      output: toJsonSafe(result.output),
      success: inferToolResultSuccess(result.output),
    })),
  }))
}

export function getLastUserQuery(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as {
      role?: string
      parts?: Array<{ type?: string; text?: string }>
      content?: string
    }

    if (message.role !== 'user') continue

    if (Array.isArray(message.parts)) {
      const content = extractVisibleTextFromUIMessageParts(message.parts)
      if (content.trim().length > 0) return content
    }

    if (typeof message.content === 'string' && message.content.trim().length > 0) {
      return message.content
    }
  }

  return ''
}

export function getFinalVisibleTextFromSteps(
  steps: StepResultLike[],
  generatedText: string
): string {
  const finalStepText = (steps[steps.length - 1]?.text ?? '').trim()
  if (finalStepText.length > 0) {
    return extractVisibleTextFromStepTexts([finalStepText])
  }

  // If we used tools and ended without a final prose step, prefer no text over
  // leaking intermediate planning/search narration.
  if (steps.length > 1) {
    return ''
  }

  return extractVisibleTextFromStepTexts([generatedText])
}

export function getNonEmptyStepTextCount(steps: StepResultLike[]): number {
  return steps.reduce((count, step) => {
    return count + ((step.text ?? '').trim().length > 0 ? 1 : 0)
  }, 0)
}

// Keep in sync with META_NARRATION_PATTERN in evals/lib/checks.ts
// Refined to genuine tool-work narration only — dropped the ambient "looking
// for", "I'll look", "I'm trying" matches that flagged natural phrasing.
export const META_NARRATION_PATTERN =
  /\b(?:let me\s+(?:check|search|look|try)|search(?:ing now| again)|still getting|different angle)\b/i

/**
 * Remove tool/process narration from assistant text when structured results
 * (event cards or directions) are already present.
 */
export function sanitizeFinalAssistantText(
  text: string,
  options: { hasStructuredData: boolean }
): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  if (!options.hasStructuredData) return trimmed

  const endsWithColon = /:\s*$/.test(trimmed)
  const shortText = trimmed.length <= 180
  const hasMetaNarration = META_NARRATION_PATTERN.test(trimmed)

  if (hasMetaNarration && (endsWithColon || shortText)) {
    return ''
  }

  return trimmed
}

/**
 * Normalize a string for event-name matching in assistant text: lowercase,
 * collapse whitespace, strip emoji and the "|" separator used in titles.
 */
export function normalizeForNameMatch(value: string): string {
  return value
    .toLowerCase()
    // Strip emoji (event titles often carry decorative glyphs)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, ' ')
    // The " | " separator splits a title from its subtitle ("Name | Brand")
    .replace(/[|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Filter accumulated events down to the ones the final assistant text actually
 * mentions by name. Discovery lists can opt out because their concise prose
 * adds judgment while the cards carry the complete option set.
 *
 * Falls back to all events when nothing matches (generic "here are options"
 * replies that present a list without naming each event).
 */
export function filterEventsMentionedInText(
  events: ChatEventPayload[],
  finalText: string,
  options?: { preserveAll?: boolean }
): ChatEventPayload[] {
  if (events.length === 0 || !finalText || options?.preserveAll) return events

  const normalizedText = normalizeForNameMatch(finalText)
  const mentioned = events.filter((event) => {
    const name = normalizeForNameMatch(event.name)
    if (!name) return false
    // Match the full title, or any significant segment (before "|", or the
    // first 3+ words) so "Make Friends: Deep talks & Coffee" matches the card
    // even when the model drops the subtitle.
    if (normalizedText.includes(name)) return true
    const segments = name.split(' ')
    if (segments.length >= 3) {
      const core = segments.slice(0, 3).join(' ')
      if (normalizedText.includes(core)) return true
    }
    return false
  })

  return mentioned.length > 0 ? mentioned : events
}

export function buildStreamEnvelope<T>(
  requestId: string,
  data: T,
  assistantMessageId?: string
): ChatStreamDataEnvelope<T> {
  return {
    requestId,
    assistantMessageId,
    data,
  }
}
