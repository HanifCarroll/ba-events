import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TelegramTurnDependencies } from './turn.ts'
import { processTelegramTurn } from './turn.ts'
import { sealTelegramEnvelope } from './envelope.server.ts'

const key = Buffer.alloc(32, 8).toString('base64')
const identityHash = 'a'.repeat(64)
const queueKey = '11111111-1111-4111-8111-111111111111'
const conversation = {
  id: queueKey,
  channel: 'telegram' as const,
  title: 'New conversation',
  created_at: '2026-08-23T00:00:00Z',
  updated_at: '2026-08-23T00:00:00Z',
  metadata: {},
}

function payload(plaintext: Record<string, unknown>, updateId = '42') {
  const { userId: _userId, messageId: _messageId, ...minimal } = plaintext
  return {
    updateId,
    queueKey,
    sealedEnvelope: sealTelegramEnvelope(
      { identityHash, ...minimal },
      key,
      updateId,
      queueKey
    ),
  }
}

function dependencies(metadata: Record<string, unknown> = {}): TelegramTurnDependencies {
  return {
    getEnvelopeKey: vi.fn(async () => key) as never,
    getConversation: vi.fn(async () => ({ ...conversation, metadata })) as never,
    loadMessages: vi.fn(async () => []) as never,
    insertMessage: vi.fn(async (input: { role: string }) => ({
      id: input.role === 'user' ? 'user-row' : 'assistant-row',
    })) as never,
    updateMetadata: vi.fn(async () => ({ ...conversation, metadata })) as never,
    clearMessages: vi.fn(async () => undefined) as never,
    deleteConversation: vi.fn(async () => undefined) as never,
    redactClaims: vi.fn(async () => undefined) as never,
    runTurn: vi.fn(async () => ({
      canonical: { text: 'canonical result' },
      executionTrace: [{ tool: 'search_events' }],
      reads: [],
      providerRequestId: null,
    })) as never,
    render: vi.fn(() => ({ text: 'rendered result' })) as never,
    sendMessage: vi.fn(async () => undefined),
    sendTyping: vi.fn(async () => undefined),
    answerCallback: vi.fn(async () => undefined),
    markCompleted: vi.fn(async () => undefined) as never,
    markFailed: vi.fn(async () => undefined) as never,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('Telegram turn processor', () => {
  it('no-ops when an earlier privacy action already redacted the key', async () => {
    const deps = dependencies()
    deps.getEnvelopeKey = vi.fn(async () => null) as never
    await expect(processTelegramTurn(
      payload({ chatId: '123', text: 'events tonight' }),
      deps
    )).resolves.toBeUndefined()
    expect(deps.getConversation).not.toHaveBeenCalled()
    expect(deps.markFailed).not.toHaveBeenCalled()
  })

  it('processes a new user query without consent metadata', async () => {
    const deps = dependencies()
    await processTelegramTurn(
      payload({ chatId: '123', userId: '123', messageId: '9', text: 'milongas', languageCode: 'es' }),
      deps
    )

    expect(deps.runTurn).toHaveBeenCalledWith(expect.objectContaining({ text: 'milongas', locale: 'es' }))
    expect(deps.insertMessage).toHaveBeenCalledTimes(2)
  })

  it('acknowledges legacy accept without restoring a consent gate, and deletes on decline', async () => {
    const accepted = dependencies()
    await processTelegramTurn(
      payload({
        chatId: '123',
        userId: '123',
        messageId: '9',
        callbackId: 'callback-1',
        callbackData: 'consent:v1:accept',
        languageCode: 'en',
      }),
      accepted
    )
    expect(accepted.updateMetadata).not.toHaveBeenCalled()
    expect(accepted.answerCallback).toHaveBeenCalled()
    expect(accepted.sendMessage).toHaveBeenCalledWith(
      '123',
      { text: 'Thanks. You can send me an event question anytime.' },
    )

    const declined = dependencies()
    declined.answerCallback = vi.fn(async () => {
      throw new Error('callback query is too old')
    })
    declined.sendMessage = vi.fn(async () => {
      throw new Error('bot blocked')
    })
    await expect(processTelegramTurn(
      payload({
        chatId: '123',
        userId: '123',
        messageId: '9',
        callbackId: 'callback-2',
        callbackData: 'consent:v1:decline',
      }),
      declined
    )).resolves.toBeUndefined()
    expect(declined.deleteConversation).toHaveBeenCalledWith({
      channel: 'telegram',
      conversationId: queueKey,
    })
    expect(declined.redactClaims).toHaveBeenCalledWith(identityHash)
    expect(declined.getConversation).not.toHaveBeenCalled()
    expect(declined.sendMessage).toHaveBeenCalledWith(
      '123',
      expect.objectContaining({ text: expect.stringContaining('Declined') })
    )
    expect(declined.markCompleted).not.toHaveBeenCalled()
  })

  it('detects and persists a changed natural-text locale per turn', async () => {
    const deps = dependencies({ locale: 'es' })
    await processTelegramTurn(
      payload({ chatId: '123', userId: '123', messageId: '9', text: 'events tonight' }),
      deps
    )

    expect(deps.updateMetadata).toHaveBeenCalledWith({
      channel: 'telegram',
      conversationId: conversation.id,
      metadataPatch: { locale: 'en' },
    })
    expect(deps.runTurn).toHaveBeenCalledWith(expect.objectContaining({ locale: 'en' }))
    expect(deps.render).toHaveBeenCalledWith(expect.anything(), 'en')
  })

  it('persists one canonical turn with stable ids and parent before delivery', async () => {
    const deps = dependencies({ locale: 'es' })
    await processTelegramTurn(
      payload({ chatId: '123', userId: '123', messageId: '9', text: 'milongas' }),
      deps
    )
    expect(deps.sendTyping).toHaveBeenCalledWith('123')
    expect(deps.runTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'telegram:42',
        userContext: { userId: null, isAuthenticated: false },
        text: 'milongas',
        locale: 'es',
      })
    )
    expect(deps.insertMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ clientMessageId: 'telegram:42:user', role: 'user' })
    )
    expect(deps.insertMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        parentMessageId: 'user-row',
        clientMessageId: 'telegram:42:assistant',
        role: 'assistant',
        attachedData: { canonical: { text: 'canonical result' } },
      })
    )
    expect((deps.insertMessage as ReturnType<typeof vi.fn>).mock.invocationCallOrder[1]).toBeLessThan(
      (deps.sendMessage as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    )
  })

  it.each(['/start', '/help', '/privacy'] as const)(
    'handles %s without invoking AI',
    async (command) => {
      const deps = dependencies()
      await processTelegramTurn(
        payload({ chatId: '123', userId: '123', messageId: '9', text: command }),
        deps
      )
      expect(deps.runTurn).not.toHaveBeenCalled()
      expect(deps.sendMessage).toHaveBeenCalledTimes(1)
    }
  )

  it('uses a localized HTTPS privacy button for /start and /privacy', async () => {
    const start = dependencies()
    await processTelegramTurn(payload({ chatId: '123', text: '/start' }), start)
    expect(start.sendMessage).toHaveBeenCalledWith('123', expect.objectContaining({
      text: expect.stringContaining('By continuing, you agree to the privacy policy.'),
      replyMarkup: { inline_keyboard: [[{ text: 'Privacy', url: 'https://baeventos.com/privacy' }]] },
    }))

    const privacy = dependencies()
    await processTelegramTurn(payload({ chatId: '123', text: '/privacy' }), privacy)
    expect(privacy.sendMessage).toHaveBeenCalledWith('123', expect.objectContaining({
      replyMarkup: { inline_keyboard: [[{ text: 'Privacy', url: 'https://baeventos.com/privacy' }]] },
    }))
  })

  it('clears history on /new and hard-deletes on /delete', async () => {
    const fresh = dependencies()
    await processTelegramTurn(
      payload({ chatId: '123', userId: '123', messageId: '9', text: '/new' }),
      fresh
    )
    expect(fresh.clearMessages).toHaveBeenCalledWith({
      channel: 'telegram',
      conversationId: conversation.id,
    })
    expect(fresh.updateMetadata).toHaveBeenCalledWith({
      channel: 'telegram',
      conversationId: conversation.id,
      metadataPatch: { locale: 'en' },
    })

    const deleted = dependencies()
    deleted.sendMessage = vi.fn(async () => {
      throw new Error('bot blocked')
    })
    await expect(processTelegramTurn(
      payload({ chatId: '123', userId: '123', messageId: '9', text: '/delete' }),
      deleted
    )).resolves.toBeUndefined()
    expect(deleted.deleteConversation).toHaveBeenCalledWith({
      channel: 'telegram',
      conversationId: queueKey,
    })
    expect(deleted.redactClaims).toHaveBeenCalledWith(identityHash)
    expect(deleted.getConversation).not.toHaveBeenCalled()
    expect(deleted.markCompleted).not.toHaveBeenCalled()
  })
})
