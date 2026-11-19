import { afterEach, describe, expect, it, vi } from 'vitest'
import { useD1Binding } from '#shared/lib/db/d1-binding.server.ts'
import { buildGuestDebugTranscript, persistGuestChatDebug, recordGuestRequestStarted, recordGuestRequestTerminal } from './guest-debug.server.ts'

function bindRun(run: () => Promise<unknown>) {
  useD1Binding({ DB: { prepare: () => ({ bind: () => ({ run }) }), batch: vi.fn() } })
}
afterEach(() => { vi.useRealTimers(); useD1Binding(undefined) })

const transcript = () => persistGuestChatDebug({ conversationId: 'guest-1', locale: 'en', ip: '203.0.113.7', messages: [], lastUserText: null })
const start = () => recordGuestRequestStarted({ requestId: 'req-1', conversationId: 'guest-1' })
const terminal = () => recordGuestRequestTerminal({ requestId: 'req-1', conversationId: 'guest-1', status: 'completed' })

for (const [name, persist] of Object.entries({ transcript, start, terminal })) {
  it(`awaits the ${name} write`, async () => {
    const gate = Promise.withResolvers<void>()
    const run = vi.fn(() => gate.promise)
    bindRun(run)
    let settled = false
    const pending = persist().then(() => { settled = true })
    await Promise.resolve()
    expect(run).toHaveBeenCalledTimes(1)
    expect(settled).toBe(false)
    gate.resolve()
    await pending
    expect(settled).toBe(true)
  })

  it(`fails open when the ${name} write stalls`, async () => {
    vi.useFakeTimers()
    bindRun(() => new Promise(() => {}))
    const pending = persist()
    await vi.advanceTimersByTimeAsync(1500)
    await expect(pending).resolves.toBeUndefined()
  })
}

it('does not touch D1 without the relevant diagnostic identifier', async () => {
  const run = vi.fn()
  bindRun(run)
  await persistGuestChatDebug({ conversationId: null, locale: 'en', ip: '203.0.113.7', messages: [], lastUserText: null })
  await recordGuestRequestStarted({ requestId: '', conversationId: 'guest-1' })
  await recordGuestRequestTerminal({ requestId: '', conversationId: 'guest-1', status: 'completed' })
  expect(run).not.toHaveBeenCalled()
})

describe('buildGuestDebugTranscript', () => {
  it('appends the assembled assistant message after incoming uiMessages', () => {
    const uiMessages = [
      { id: 'u1', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Hi' }] },
    ]
    const transcript = buildGuestDebugTranscript(uiMessages, {
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Hello' }],
      executionTrace: [{ stepIndex: 0, stepType: 'initial', text: '', finishReason: 'tool-calls', toolCalls: [], toolResults: [] }],
    })

    expect(transcript).toHaveLength(2)
    expect(transcript[0]).toEqual(uiMessages[0])
    expect(transcript[1]).toMatchObject({
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Hello' }],
    })
  })

  it('includes the canonical data-response part, not text alone', () => {
    const canonical = { contractVersion: 3, requestId: 'req-1', kind: 'recommendations' }
    const uiMessages = [
      { id: 'u1', role: 'user' as const, parts: [{ type: 'text' as const, text: 'Hi' }] },
    ]
    const transcript = buildGuestDebugTranscript(uiMessages, {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Here' },
        { type: 'data-response', data: canonical },
      ],
    })
    const assistant = transcript[1] as { parts: Array<{ type?: string; data?: unknown }> }
    expect(assistant.parts.some((p) => p.type === 'data-response' && p.data === canonical)).toBe(true)
  })
})
