import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('#shared/lib/db/service.server.ts', () => ({
  getSupabaseServiceRoleClient: vi.fn(),
}))

import { getSupabaseServiceRoleClient } from '#shared/lib/db/service.server.ts'
import {
  buildGuestDebugTranscript,
  persistGuestChatDebug,
  recordGuestRequestStarted,
  recordGuestRequestTerminal,
  upsertGuestChatDebug,
} from './guest-debug.server.ts'

// The mocked module export IS the mock fn; cast only for typing
// (bun test does not provide vi.mocked).
const getClientMock = getSupabaseServiceRoleClient as unknown as Mock
let upsertMock: Mock
let insertMock: Mock
let updateMock: Mock
let eqMock: Mock

beforeEach(() => {
  vi.resetAllMocks()
  upsertMock = vi.fn()
  insertMock = vi.fn()
  eqMock = vi.fn()
  updateMock = vi.fn().mockReturnValue({ eq: eqMock })
  getClientMock.mockReturnValue({
    from: vi
      .fn()
      .mockReturnValue({ upsert: upsertMock, insert: insertMock, update: updateMock }),
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

  it('awaits the upsert so terminal persistence cannot be lost', async () => {
    const { promise: upsertGate, resolve: resolveUpsert } =
      Promise.withResolvers<{ error: null }>()
    upsertMock.mockImplementation(() => upsertGate)

    let persisted = false
    const persistPromise = persistGuestChatDebug({
      conversationId: 'guest-nanoid-123',
      locale: 'en',
      ip: '203.0.113.7',
      messages: [{ role: 'user' }],
      lastUserText: 'Hi',
    }).then(() => {
      persisted = true
    })

    await Promise.resolve()
    expect(upsertMock).toHaveBeenCalledTimes(1)
    expect(persisted).toBe(false)

    resolveUpsert({ error: null })
    await persistPromise
    expect(persisted).toBe(true)
  })

  it('fails open when the transcript write never settles', async () => {
    vi.useFakeTimers()
    try {
      upsertMock.mockReturnValue(Promise.withResolvers<never>().promise)
      const promise = persistGuestChatDebug({
        conversationId: 'guest-nanoid-123',
        locale: 'en',
        ip: '203.0.113.7',
        messages: [],
        lastUserText: null,
      })
      await vi.advanceTimersByTimeAsync(2000)
      await expect(promise).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
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

describe('recordGuestRequestStarted', () => {
  it('inserts a started row keyed by request id', async () => {
    insertMock.mockResolvedValue({ error: null })

    await recordGuestRequestStarted({
      requestId: 'req-1',
      conversationId: 'conv-1',
    })

    expect(getClientMock).toHaveBeenCalledTimes(1)
    expect(getClientMock.mock.results[0].value.from).toHaveBeenCalledWith(
      'guest_request_lifecycle'
    )
    expect(insertMock).toHaveBeenCalledTimes(1)

    const payload = insertMock.mock.calls[0][0] as Record<string, unknown>
    expect(payload.request_id).toBe('req-1')
    expect(payload.conversation_id).toBe('conv-1')
    expect(payload.status).toBe('started')
    expect(payload.started_at).toBeTypeOf('string')
  })

  it('is a no-op when requestId is missing', async () => {
    await recordGuestRequestStarted({ requestId: '', conversationId: 'conv-1' })

    expect(getClientMock).not.toHaveBeenCalled()
    expect(insertMock).not.toHaveBeenCalled()
  })
})

describe('recordGuestRequestTerminal', () => {
  it('upserts the same row to completed with an ended_at', async () => {
    upsertMock.mockResolvedValue({ error: null })

    await recordGuestRequestTerminal({
      requestId: 'req-1',
      conversationId: 'conv-1',
      status: 'completed',
      providerRequestId: 'provider-1',
    })

    expect(getClientMock.mock.results[0].value.from).toHaveBeenCalledWith(
      'guest_request_lifecycle'
    )
    expect(upsertMock).toHaveBeenCalledTimes(1)

    const payload = upsertMock.mock.calls[0][0] as Record<string, unknown>
    expect(payload.request_id).toBe('req-1')
    expect(payload.conversation_id).toBe('conv-1')
    expect(payload.status).toBe('completed')
    expect(payload.ended_at).toBeTypeOf('string')
    expect(payload.error_type).toBeNull()
    expect(payload.provider_request_id).toBe('provider-1')

    const options = upsertMock.mock.calls[0][1] as { onConflict?: string }
    expect(options.onConflict).toBe('request_id')
  })

  it('upserts the same row to errored with an error type', async () => {
    upsertMock.mockResolvedValue({ error: null })

    await recordGuestRequestTerminal({
      requestId: 'req-1',
      conversationId: 'conv-1',
      status: 'errored',
      errorType: 'APICallError',
    })

    const payload = upsertMock.mock.calls[0][0] as Record<string, unknown>
    expect(payload.status).toBe('errored')
    expect(payload.ended_at).toBeTypeOf('string')
    expect(payload.error_type).toBe('APICallError')
    expect(payload.provider_request_id).toBeNull()
  })

  it('upserts completed_with_fallback with the exact fallback reason', async () => {
    upsertMock.mockResolvedValue({ error: null })

    await recordGuestRequestTerminal({
      requestId: 'req-1',
      conversationId: 'conv-1',
      status: 'completed_with_fallback',
      errorType: 'invalid_schema',
    })

    const payload = upsertMock.mock.calls[0][0] as Record<string, unknown>
    expect(payload.status).toBe('completed_with_fallback')
    expect(payload.error_type).toBe('invalid_schema')
  })

  it('does not clobber started_at on an existing row', async () => {
    upsertMock.mockResolvedValue({ error: null })

    await recordGuestRequestTerminal({
      requestId: 'req-1',
      conversationId: 'conv-1',
      status: 'completed',
    })

    const payload = upsertMock.mock.calls[0][0] as Record<string, unknown>
    expect(payload.started_at).toBeUndefined()
  })

  it('creates a terminal row when the started insert never landed', async () => {
    upsertMock.mockResolvedValue({ error: null })

    await recordGuestRequestTerminal({
      requestId: 'req-1',
      conversationId: 'conv-1',
      status: 'errored',
      errorType: 'APICallError',
    })

    expect(upsertMock).toHaveBeenCalledTimes(1)
    const options = upsertMock.mock.calls[0][1] as { onConflict?: string }
    expect(options.onConflict).toBe('request_id')

    // Full required fields for the insert path; started_at is supplied by the
    // column DEFAULT now() so the existing start time survives a conflict.
    const payload = upsertMock.mock.calls[0][0] as Record<string, unknown>
    expect(payload.request_id).toBe('req-1')
    expect(payload.conversation_id).toBe('conv-1')
    expect(payload.status).toBe('errored')
    expect(payload.ended_at).toBeTypeOf('string')
    expect(payload.error_type).toBe('APICallError')
  })
})

describe('request lifecycle timeout fail-open', () => {
  it('resolves when the started write never settles', async () => {
    vi.useFakeTimers()
    try {
      insertMock.mockReturnValue(Promise.withResolvers<never>().promise)

      const promise = recordGuestRequestStarted({
        requestId: 'req-1',
        conversationId: 'conv-1',
      })
      await vi.advanceTimersByTimeAsync(2000)

      await expect(promise).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('resolves when the terminal write never settles', async () => {
    vi.useFakeTimers()
    try {
      upsertMock.mockReturnValue(Promise.withResolvers<never>().promise)

      const promise = recordGuestRequestTerminal({
        requestId: 'req-1',
        conversationId: 'conv-1',
        status: 'completed',
      })
      await vi.advanceTimersByTimeAsync(2000)

      await expect(promise).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})
