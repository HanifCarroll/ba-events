/**
 * Sanitized reads-only execution trace for persistence and debugging.
 *
 * Contains sanitized tool calls/results only. Embeddings are stripped
 * recursively; there is no model reasoning or work-loop text.
 */

import type { MessageExecutionStep, Json } from '#shared/lib/types.ts'

export type RawStep = {
  stepNumber?: number
  finishReason?: string
  toolCalls?: Array<{ toolCallId?: string; toolName?: string; input?: unknown }>
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

function successOf(output: unknown): boolean {
  if (output && typeof output === 'object' && 'success' in output) {
    const s = (output as { success?: unknown }).success
    if (typeof s === 'boolean') return s
  }
  return true
}

export function buildSanitizedTrace(steps: RawStep[]): MessageExecutionStep[] {
  return steps.map((step, index) => ({
    stepIndex: index,
    stepType: index === 0 ? 'initial' : 'tool-result',
    text: '',
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
      success: successOf(result.output),
    })),
  }))
}
