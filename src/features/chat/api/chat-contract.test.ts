import { describe, expect, it } from 'vitest'
import {
  buildExecutionTrace,
  chunkTextForStream,
  filterEventsMentionedInText,
  getFinalVisibleTextFromSteps,
  sanitizeFinalAssistantText,
  stripLeakedReasoning,
  type StepResultLike,
} from '#features/chat/api/stream-helpers.ts'
import { ensureChatEventPayload } from './tools/utils.ts'
import type { ChatEventPayload } from '#shared/lib/types.ts'

function event(id: string, name: string): ChatEventPayload {
  return { id, name } as ChatEventPayload
}

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

  it('returns empty for all-empty multi-step responses (never falls back to generated text)', () => {
    const steps: StepResultLike[] = [{ text: '' }, { text: '   ' }]
    const finalText = getFinalVisibleTextFromSteps(steps, 'Fallback final answer.')
    expect(finalText).toBe('')
  })

  it('falls back to generated text for single-step non-tool responses', () => {
    const steps: StepResultLike[] = [{ text: '' }]
    const finalText = getFinalVisibleTextFromSteps(steps, 'Fallback final answer.')
    expect(finalText).toBe('Fallback final answer.')
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

  it('copies step reasoning onto the execution trace', () => {
    const steps: StepResultLike[] = [
      {
        text: '',
        reasoning: 'Next weekend means Aug 22-23, not leftover Saturday.',
        toolCalls: [],
        toolResults: [],
      },
    ]

    const trace = buildExecutionTrace(steps)
    expect(trace[0].reasoning).toBe('Next weekend means Aug 22-23, not leftover Saturday.')
  })

  it('chunks a finished answer into typed deltas', () => {
    expect(chunkTextForStream('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
    expect(chunkTextForStream('')).toEqual([])
  })

  it('strips embeddings from execution trace tool outputs', () => {
    const steps: StepResultLike[] = [
      {
        toolResults: [
          {
            toolName: 'search_events',
            output: {
              success: true,
              events: [
                {
                  id: 'event_1',
                  name: 'Club night',
                  embedding: [0.1, 0.2, 0.3],
                },
              ],
            },
          },
        ],
      },
    ]

    const trace = buildExecutionTrace(steps)
    expect(JSON.stringify(trace)).not.toContain('embedding')
    expect(trace[0].toolResults[0].output).toMatchObject({
      success: true,
      events: [{ id: 'event_1', name: 'Club night' }],
    })
  })

  it('strips embeddings from chat event payloads', () => {
    const event = {
      id: 'event_1',
      name: 'Club night',
      embedding: [0.1, 0.2, 0.3],
    }

    const payload = ensureChatEventPayload(event as never)
    expect('embedding' in payload).toBe(false)
    expect(payload).toMatchObject({ id: 'event_1', name: 'Club night' })
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

  it('drops answer text that is just a copy of streamed reasoning', () => {
    const reasoning =
      'The user wants something chill. Let me search with a query for chill vibes.'
    expect(stripLeakedReasoning(reasoning, reasoning)).toBe('')
  })

  it('keeps a real answer after a leaked reasoning prefix', () => {
    const reasoning = 'The user wants something chill. Let me search.'
    expect(
      stripLeakedReasoning(
        `${reasoning}\n\nBest pick: the Sunday acoustic set in Palermo.`,
        reasoning
      )
    ).toBe('Best pick: the Sunday acoustic set in Palermo.')
  })

  it('drops unmarked CoT that still reads like planning notes', () => {
    expect(
      stripLeakedReasoning(
        'The user asked for next weekend. I should search with time filter weekend. Keep it short and let the cards carry details.',
        ''
      )
    ).toBe('')
  })

  it('filters cards to events mentioned in the answer text', () => {
    const events = [
      event('e1', 'Make Friends: Deep talks & Coffee | 🌍 Culture Shock Therapy'),
      event('e2', 'Explorar | Ecstatic Dance'),
      event('e3', '💃🕺 BA Digital Nomads - After Office @ Behind Bar'),
    ]
    const text =
      "Here's a calmer pick for you: **Make Friends: Deep talks & Coffee** — just chatting over coffee."

    const filtered = filterEventsMentionedInText(events, text)
    expect(filtered.map((e) => e.id)).toEqual(['e1'])
  })

  it('matches an event mentioned by its first words when subtitle is dropped', () => {
    const events = [
      event('e1', 'Make Friends: Deep talks & Coffee | Culture Shock Therapy'),
      event('e2', 'BA Digital Nomads - After Office @ Behind Bar'),
    ]
    const text = 'I would go with BA Digital Nomads for the drinks and no agenda.'

    const filtered = filterEventsMentionedInText(events, text)
    expect(filtered.map((e) => e.id)).toEqual(['e2'])
  })

  it('keeps all events when the text is a generic list with no specific names', () => {
    const events = [
      event('e1', 'Make Friends: Deep talks & Coffee'),
      event('e2', 'BA Digital Nomads'),
    ]
    const text = 'Here are some good options for a relaxed night out.'

    const filtered = filterEventsMentionedInText(events, text)
    expect(filtered.map((e) => e.id)).toEqual(['e1', 'e2'])
  })

  it('keeps every discovery card when the prose only names the best pick', () => {
    const events = [
      event('e1', 'Make Friends: Deep talks & Coffee'),
      event('e2', 'Café, manos y creatividad'),
    ]
    const text = 'Best pick: Make Friends — it is structured around real conversation.'

    const filtered = filterEventsMentionedInText(events, text, { preserveAll: true })
    expect(filtered.map((e) => e.id)).toEqual(['e1', 'e2'])
  })

  it('returns empty for no events or empty text', () => {
    expect(filterEventsMentionedInText([], 'anything')).toEqual([])
    expect(filterEventsMentionedInText([event('e1', 'Club night')], '')).toEqual([
      event('e1', 'Club night'),
    ])
  })
})
