import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('#shared/lib/db/service.server.ts', () => ({
  getSupabaseServiceRoleClient: vi.fn(),
}))

import { getSupabaseServiceRoleClient } from '#shared/lib/db/service.server.ts'
import {
  buildGuestDebugTranscript,
  persistGuestChatDebug,
  upsertGuestChatDebug,
} from './guest-debug.server.ts'

// The mocked module export IS the mock fn; cast only for typing
// (bun test does not provide vi.mocked).
const getClientMock = getSupabaseServiceRoleClient as unknown as Mock
let upsertMock: Mock

beforeEach(() => {
  vi.resetAllMocks()
  upsertMock = vi.fn()
  getClientMock.mockReturnValue({
    from: vi.fn().mockReturnValue({ upsert: upsertMock }),
  })
})

describe('upsertGuestChatDebug', () => {

  it('upserts with the conversation id and full message payload', async () => {
    upsertMock.mockResolvedValue({ error: null })

    const messages = [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }]

    await upsertGuestChatDebug({
      conversationId: 'guest-nanoid-123',
      locale: 'es',
      ip: '203.0.113.7',
      messages,
      lastUserText: 'Hi',
    })

    expect(getClientMock).toHaveBeenCalledTimes(1)
    expect(getClientMock.mock.results[0].value.from).toHaveBeenCalledWith('guest_chat_debug')
    expect(upsertMock).toHaveBeenCalledTimes(1)

    const payload = upsertMock.mock.calls[0][0] as Record<string, unknown>
    expect(payload.conversation_id).toBe('guest-nanoid-123')
    expect(payload.locale).toBe('es')
    expect(payload.ip).toBe('203.0.113.7')
    expect(payload.messages).toEqual(messages)
    expect(payload.last_user_text).toBe('Hi')
    expect(payload.updated_at).toBeTypeOf('string')

    const options = upsertMock.mock.calls[0][1] as { onConflict?: string }
    expect(options.onConflict).toBe('conversation_id')
  })

  it('is a no-op when conversationId is missing', async () => {
    await upsertGuestChatDebug({
      conversationId: '',
      locale: 'en',
      ip: '203.0.113.7',
      messages: [],
      lastUserText: null,
    })

    expect(getClientMock).not.toHaveBeenCalled()
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('swallows a client throw so the chat response is never blocked', async () => {
    upsertMock.mockRejectedValue(new Error('db down'))

    await expect(
      upsertGuestChatDebug({
        conversationId: 'guest-nanoid-123',
        locale: 'en',
        ip: '203.0.113.7',
        messages: [],
        lastUserText: null,
      })
    ).resolves.toBeUndefined()
  })
})

describe('persistGuestChatDebug', () => {
  it('is a no-op when conversationId is null', async () => {
    persistGuestChatDebug({
      conversationId: null,
      locale: 'en',
      ip: '203.0.113.7',
      messages: [],
      lastUserText: null,
    })

    await Promise.resolve()

    expect(getClientMock).not.toHaveBeenCalled()
  })

  it('fire-and-forgets an upsert for a guest conversation', async () => {
    upsertMock.mockResolvedValue({ error: null })

    persistGuestChatDebug({
      conversationId: 'guest-nanoid-123',
      locale: 'en',
      ip: '203.0.113.7',
      messages: [{ role: 'user' }],
      lastUserText: 'Hi',
    })

    await vi.waitFor(() => {
      expect(upsertMock).toHaveBeenCalledTimes(1)
    })
  })
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
})
