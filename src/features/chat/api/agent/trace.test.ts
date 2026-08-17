import { describe, expect, it } from 'vitest'
import { buildSanitizedTrace } from './trace.ts'

describe('buildSanitizedTrace', () => {
  it('contains tool calls/results only — no reasoning and no work narration text', () => {
    const trace = buildSanitizedTrace([
      {
        finishReason: 'tool-calls',
        toolCalls: [{ toolCallId: 'c1', toolName: 'search_events', input: { query: 'jazz' } }],
        toolResults: [
          { toolCallId: 'c1', toolName: 'search_events', input: { query: 'jazz' }, output: { success: true, events: [] } },
        ],
      },
    ])
    expect(trace).toHaveLength(1)
    expect(trace[0].text).toBe('')
    expect('reasoning' in trace[0]).toBe(false)
    expect(trace[0].toolCalls[0]).toMatchObject({ toolCallId: 'c1', toolName: 'search_events' })
    expect(trace[0].toolResults[0].success).toBe(true)
  })

  it('strips embeddings from tool outputs', () => {
    const trace = buildSanitizedTrace([
      {
        toolResults: [
          {
            toolCallId: 'c1',
            toolName: 'search_events',
            output: { success: true, events: [{ id: 'e1', name: 'X', embedding: [0.1, 0.2] }] },
          },
        ],
      },
    ])
    expect(JSON.stringify(trace)).not.toContain('embedding')
  })
})
