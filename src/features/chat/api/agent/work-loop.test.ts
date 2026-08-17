import { describe, expect, it, vi, beforeEach } from 'vitest'

import { runWorkLoop, MAX_WORK_STEPS } from './work-loop.ts'
import { event } from './_test-helpers.ts'

// Dependency injection (no vi.mock) so these tests run identically under Bun's
// native runner and Vitest without cross-file module-mock leakage.
const mockGenerateText = vi.fn()
const mockCreateInstrumentedTools = vi.fn(() => ({}))

function searchToolCall(id: string, input: unknown) {
  return { toolCallId: id, toolName: 'search_events', input }
}

function searchToolResult(id: string, input: unknown, events: ReturnType<typeof event>[]) {
  return {
    toolCallId: id,
    toolName: 'search_events',
    input,
    output: {
      success: true,
      events,
      metadata: {
        resultCount: events.length,
        displayLimit: events.length,
        coverage: { searchedTo: null, maxEventDate: null },
        toolInput: input,
      },
    },
  }
}

function fakeResult(opts: {
  stepNumber: number
  finishReason: string
  toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>
  toolResults: Array<{ toolCallId: string; toolName: string; input: unknown; output: unknown }>
  text?: string
  content?: Array<{ type: string; toolCallId?: string }>
  responseId?: string
  responseMessages?: unknown[]
}) {
  const responseId = opts.responseId ?? `prov-${opts.stepNumber}`
  const responseMessages = opts.responseMessages ?? [
    { role: 'assistant', content: `[assistant ${responseId}]` },
    { role: 'tool', content: `[tool ${responseId}]` },
  ]
  return {
    text: opts.text ?? '',
    reasoningText: undefined,
    steps: [
      {
        stepNumber: opts.stepNumber,
        finishReason: opts.finishReason,
        toolCalls: opts.toolCalls,
        toolResults: opts.toolResults,
        content: opts.content ?? [],
      },
    ],
    response: { id: responseId, messages: responseMessages },
  }
}

const baseInput = {
  requestId: 'req-1',
  modelMessages: [],
  systemPrompt: 'concierge',
  userContext: { userId: null, isAuthenticated: false },
  locale: 'en' as const,
  generateTextFn: mockGenerateText as never,
  createInstrumentedToolsFn: mockCreateInstrumentedTools as never,
}

describe('runWorkLoop (two real generateText generations)', () => {
  beforeEach(() => {
    mockGenerateText.mockReset()
    mockCreateInstrumentedTools.mockReset()
    mockCreateInstrumentedTools.mockReturnValue({})
  })

  it('rejects speed-dating via ephemeral work text and ends in later tango/music/jazz tool calls', async () => {
    const speed = event('speed1', 'Speed dating')
    const tango = event('tango', 'Tango night')
    const music = event('music', 'Live music')
    const jazz = event('jazz', 'Jazz set')

    const gen0Messages = [{ role: 'assistant', content: 'gen0-assistant' }]

    mockGenerateText
      .mockResolvedValueOnce(
        fakeResult({
          stepNumber: 1,
          finishReason: 'tool-calls',
          toolCalls: [searchToolCall('c0', { query: 'romantic' })],
          toolResults: [searchToolResult('c0', { query: 'romantic' }, [speed])],
          text: 'Speed dating results are unsuitable for a romantic weekday request.',
          responseId: 'prov-0',
          responseMessages: gen0Messages,
        }) as never
      )
      .mockResolvedValueOnce(
        fakeResult({
          stepNumber: 2,
          finishReason: 'tool-calls',
          toolCalls: [searchToolCall('c1', { query: 'tango' }), searchToolCall('c2', { query: 'jazz' })],
          toolResults: [
            searchToolResult('c2', { query: 'jazz' }, [music, jazz]),
            searchToolResult('c1', { query: 'tango' }, [tango]),
          ],
          text: 'Tango night, live music, and jazz sets are good romantic options.',
          responseId: 'prov-1',
        }) as never
      )

    const result = await runWorkLoop(baseInput)

    expect(mockGenerateText).toHaveBeenCalledTimes(MAX_WORK_STEPS)
    expect(mockCreateInstrumentedTools).toHaveBeenCalledTimes(1)
    expect(result.stopReason).toBe('budget_exhausted')
    expect(result.finalWorkCalledTools).toBe(true)

    const secondCallMessages = mockGenerateText.mock.calls[1]![0].messages as unknown[]
    expect(secondCallMessages).toContain(gen0Messages[0])

    expect(result.workNotes.join('\n')).toContain('unsuitable')
    expect(result.workNotes.join('\n')).toContain('Tango night')
    for (const step of result.steps) {
      expect(JSON.stringify(step)).not.toContain('unsuitable')
    }

    const searches = result.ledger.successfulSearches()
    expect(searches.map((e) => e.toolCallId)).toEqual(['c0', 'c1', 'c2'])
    expect(searches[1].events.map((e) => e.id)).toEqual(['tango'])
    expect(searches[2].events.map((e) => e.id)).toEqual(['music', 'jazz'])
    expect(result.providerRequestIds).toEqual(['prov-0', 'prov-1'])
  })

  it('stops with approval when a tool-approval-request appears in step content', async () => {
    mockGenerateText.mockResolvedValueOnce(
      fakeResult({
        stepNumber: 1,
        finishReason: 'tool-calls',
        toolCalls: [searchToolCall('c0', { query: 'x' })],
        toolResults: [],
        content: [{ type: 'tool-approval-request', toolCallId: 'c0' }],
      }) as never
    )

    const result = await runWorkLoop(baseInput)
    expect(result.stopReason).toBe('approval')
  })

  it('stops fatally when a thrown tool-error appears in step content', async () => {
    mockGenerateText.mockResolvedValueOnce(
      fakeResult({
        stepNumber: 1,
        finishReason: 'tool-calls',
        toolCalls: [searchToolCall('c0', { query: 'x' })],
        toolResults: [],
        content: [{ type: 'tool-error', toolCallId: 'c0' }],
      }) as never
    )

    const result = await runWorkLoop(baseInput)
    expect(result.stopReason).toBe('tool_error')
  })
})
