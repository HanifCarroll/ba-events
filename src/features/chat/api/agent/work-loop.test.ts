import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('ai', () => ({ generateText: vi.fn() }))
vi.mock('./tools.ts', () => ({ createInstrumentedTools: vi.fn(() => ({})) }))

import { generateText } from 'ai'
import { runWorkLoop, MAX_WORK_STEPS } from './work-loop.ts'
import { createInstrumentedTools } from './tools.ts'
import { event } from './_test-helpers.ts'

const mockGenerateText = vi.mocked(generateText)
const mockedCreateInstrumentedTools = vi.mocked(createInstrumentedTools)

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
}

describe('runWorkLoop (two real generateText generations)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
          // Model order: c1 then c2. Results complete in REVERSE order.
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

    // Two generations ran, with the configured default budget.
    expect(mockGenerateText).toHaveBeenCalledTimes(MAX_WORK_STEPS)
    // The instrumented tool set (and its mutation memo) is created once per
    // request — never once per work generation.
    expect(mockedCreateInstrumentedTools).toHaveBeenCalledTimes(1)
    expect(result.stopReason).toBe('budget_exhausted')
    expect(result.finalWorkCalledTools).toBe(true)

    // The second generation received the first generation's response messages.
    const secondCallMessages = mockGenerateText.mock.calls[1]![0].messages as unknown[]
    expect(secondCallMessages).toContain(gen0Messages[0])

    // Work text lives only in ephemeral notes, never in the trace.
    expect(result.workNotes.join('\n')).toContain('unsuitable')
    expect(result.workNotes.join('\n')).toContain('Tango night')
    for (const step of result.steps) {
      expect(JSON.stringify(step)).not.toContain('unsuitable')
    }

    // Call order survives reverse tool-result completion: c1 (tango) before c2.
    const searches = result.ledger.successfulSearches()
    expect(searches.map((e) => e.toolCallId)).toEqual(['c0', 'c1', 'c2'])
    expect(searches[1].events.map((e) => e.id)).toEqual(['tango'])
    expect(searches[2].events.map((e) => e.id)).toEqual(['music', 'jazz'])
    // Provider request ids captured per generation.
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
