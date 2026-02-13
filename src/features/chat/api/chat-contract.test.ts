import { describe, expect, it } from 'vitest'
import {
  buildStructuredDataFallbackText,
  buildExecutionTrace,
  getFinalVisibleTextFromSteps,
  getNonEmptyStepTextCount,
  sanitizeFinalAssistantText,
  type StepResultLike,
} from '@/routes/api/chat'

describe('chat final-only contract helpers', () => {
  it('derives final visible text from the final step text', () => {
    const steps: StepResultLike[] = [
      { text: "I'll check what is happening." },
      { text: 'Go to Club 69 in Palermo tonight.' },
    ]

    const finalText = getFinalVisibleTextFromSteps(steps, 'fallback text')
    expect(finalText).toBe('Go to Club 69 in Palermo tonight.')
  })

  it('returns empty when final tool step has no prose to avoid leaking intermediate narration', () => {
    const steps: StepResultLike[] = [
      { text: "That's not upscale. Let me search again." },
      { text: '' },
    ]

    const finalText = getFinalVisibleTextFromSteps(steps, 'fallback text')
    expect(finalText).toBe('')
  })

  it('falls back to generated text when all step text is empty', () => {
    const steps: StepResultLike[] = [{ text: '' }, { text: '   ' }]
    const finalText = getFinalVisibleTextFromSteps(steps, 'Fallback final answer.')
    expect(finalText).toBe('')
  })

  it('falls back to generated text for single-step non-tool responses', () => {
    const steps: StepResultLike[] = [{ text: '' }]
    const finalText = getFinalVisibleTextFromSteps(steps, 'Fallback final answer.')
    expect(finalText).toBe('Fallback final answer.')
  })

  it('counts non-empty step text for contract-violation checks', () => {
    const steps: StepResultLike[] = [{ text: '' }, { text: 'first' }, { text: ' second ' }]
    expect(getNonEmptyStepTextCount(steps)).toBe(2)
  })

  it('builds execution traces with tool call/result metadata', () => {
    const steps: StepResultLike[] = [
      {
        stepType: 'tool-result',
        text: 'final',
        finishReason: 'stop',
        toolCalls: [
          {
            toolCallId: 'call_1',
            toolName: 'search_events',
            input: { query: 'palermo club' },
          },
        ],
        toolResults: [
          {
            toolCallId: 'call_1',
            toolName: 'search_events',
            input: { query: 'palermo club' },
            output: { success: false, reason: 'none found' },
          },
        ],
      },
    ]

    const trace = buildExecutionTrace(steps)
    expect(trace).toHaveLength(1)
    expect(trace[0].toolCalls[0]).toMatchObject({
      toolCallId: 'call_1',
      toolName: 'search_events',
    })
    expect(trace[0].toolResults[0].success).toBe(false)
  })

  it('removes short meta narration when structured data exists', () => {
    const sanitized = sanitizeFinalAssistantText(
      'Still getting bar crawls. Let me try a different angle for truly upscale:',
      { hasStructuredData: true }
    )
    expect(sanitized).toBe('')
  })

  it('keeps normal recommendation text when structured data exists', () => {
    const sanitized = sanitizeFinalAssistantText(
      'Go to Trade Sky Bar tonight. It is your best upscale option with skyline views.',
      { hasStructuredData: true }
    )
    expect(sanitized).toBe('Go to Trade Sky Bar tonight. It is your best upscale option with skyline views.')
  })

  it('builds deterministic fallback summary text for structured responses', () => {
    expect(buildStructuredDataFallbackText('en', 'something more upscale or exclusive')).toBe(
      'Here are better upscale options for tonight.'
    )
    expect(buildStructuredDataFallbackText('es', 'algo más exclusivo')).toBe(
      'Aquí tienes opciones más premium para esta noche.'
    )
  })
})
