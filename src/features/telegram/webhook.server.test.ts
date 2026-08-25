import { describe, expect, it, vi } from 'vitest'
import { openTelegramEnvelope } from './envelope.server.ts'
import {
  telegramPlaintextPayloadSchema,
  type TelegramTaskPayload,
} from './task-payload.ts'
import { handleTelegramWebhook } from './webhook.server.ts'

const key = Buffer.alloc(32, 7).toString('base64')
const queueKey = '11111111-1111-4111-8111-111111111111'
type TriggerOptions = {
  idempotencyKey: string
  idempotencyKeyTTL: string
  concurrencyKey: string
}
const triggerMock = () =>
  vi.fn(async (_payload: TelegramTaskPayload, _options: TriggerOptions) => undefined)
const base = {
  webhookSecret: 'webhook-secret',
  identitySecret: 'i'.repeat(32),
  claim: vi.fn(async () => ({
    completed: false as const,
    envelopeKey: key,
    checkRateLimit: true,
  })),
  getOrCreateConversation: vi.fn(async () => ({ id: queueKey })) as never,
  attachConversation: vi.fn(async () => undefined) as never,
  markFailed: vi.fn(async () => undefined),
  rateLimit: vi.fn(async () => ({ success: true, remaining: 1, reset: 0 })),
}

function request(body: unknown, secret = 'webhook-secret') {
  return new Request('https://baeventos.com/api/telegram', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telegram-bot-api-secret-token': secret,
    },
    body: JSON.stringify(body),
  })
}

const messageUpdate = {
  update_id: 42,
  message: {
    message_id: 9,
    from: { id: 123, is_bot: false, language_code: 'es' },
    chat: { id: 123, type: 'private' },
    date: 1,
    text: 'milongas mañana',
  },
}

const promptCallbackUpdate = {
  update_id: 43,
  callback_query: {
    id: 'callback-1',
    from: { id: 123, is_bot: false, language_code: 'es' },
    message: { message_id: 10, chat: { id: 123, type: 'private' } },
    data: 'prompt:v1:weekend',
  },
}

describe('Telegram webhook', () => {
  it('authenticates before parsing and fails closed without config', async () => {
    const trigger = triggerMock()
    const malformed = new Request('https://baeventos.com/api/telegram', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'wrong' },
      body: '{',
    })
    expect((await handleTelegramWebhook(malformed, { ...base, trigger })).status).toBe(401)
    expect(
      (await handleTelegramWebhook(request(messageUpdate), {
        ...base,
        webhookSecret: undefined,
        trigger,
      })).status
    ).toBe(503)
    expect(
      (await handleTelegramWebhook(request(messageUpdate), {
        ...base,
        identitySecret: 'too-short',
        trigger,
      })).status
    ).toBe(503)
    expect(trigger).not.toHaveBeenCalled()
  })

  it('rejects declared and chunked bodies as soon as they exceed 64 KiB', async () => {
    const trigger = triggerMock()
    const declared = new Request('https://baeventos.com/api/telegram', {
      method: 'POST',
      headers: {
        'content-length': String(64 * 1024 + 1),
        'x-telegram-bot-api-secret-token': 'webhook-secret',
      },
      body: '{}',
    })
    expect((await handleTelegramWebhook(declared, { ...base, trigger })).status).toBe(413)

    const cancel = vi.fn()
    let chunk = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunk++ < 2) controller.enqueue(new Uint8Array(40 * 1024))
        else controller.close()
      },
      cancel,
    })
    const chunked = new Request('https://baeventos.com/api/telegram', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'webhook-secret' },
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })
    expect((await handleTelegramWebhook(chunked, { ...base, trigger })).status).toBe(413)
    expect(cancel).toHaveBeenCalled()
    expect(trigger).not.toHaveBeenCalled()
  })

  it('claims and triggers only an opaque sealed payload with stable options', async () => {
    const trigger = triggerMock()
    const claim = vi.fn(async () => ({
      completed: false as const,
      envelopeKey: key,
      checkRateLimit: true,
    }))
    const attachConversation = vi.fn(async () => undefined)
    const response = await handleTelegramWebhook(request(messageUpdate), {
      ...base,
      claim,
      attachConversation: attachConversation as never,
      trigger,
    })

    expect(response.status).toBe(200)
    const [payload, options] = trigger.mock.calls[0]
    expect(payload.updateId).toBe('42')
    expect(payload.queueKey).toBe(queueKey)
    expect(JSON.stringify(payload)).not.toContain('milongas')
    expect(options).toEqual({
      idempotencyKey: 'telegram-update:42',
      idempotencyKeyTTL: '30d',
      concurrencyKey: queueKey,
    })
    const plaintext = telegramPlaintextPayloadSchema.parse(
      openTelegramEnvelope(payload.sealedEnvelope, key, payload.updateId, payload.queueKey)
    )
    expect(plaintext.identityHash).toMatch(/^[a-f0-9]{64}$/)
    expect(plaintext.chatId).toBe('123')
    expect(plaintext.text).toBe('milongas mañana')
    expect(Object.keys(payload).sort()).toEqual(['queueKey', 'sealedEnvelope', 'updateId'])
    expect(JSON.stringify({ payload, options })).not.toContain(plaintext.identityHash)
    expect(claim).toHaveBeenCalledWith('42', plaintext.identityHash)
    expect(attachConversation).toHaveBeenCalledWith('42', plaintext.identityHash, queueKey)
    expect(base.getOrCreateConversation).toHaveBeenCalledWith({
      channel: 'telegram',
      externalIdentityHash: plaintext.identityHash,
      metadata: { locale: 'es' },
    })
  })

  it('starts conversation lookup and quota together after claim, and waits for both before trigger', async () => {
    const order: string[] = []
    let resolveConversation!: (value: { id: string }) => void
    let resolveRate!: (value: { success: boolean; remaining: number; reset: number }) => void
    const conversation = new Promise<{ id: string }>((resolve) => { resolveConversation = resolve })
    const rate = new Promise<{ success: boolean; remaining: number; reset: number }>((resolve) => { resolveRate = resolve })
    const attachConversation = vi.fn(async () => { order.push('attach') })
    const trigger = vi.fn(async () => { order.push('trigger') })
    const dispatch = handleTelegramWebhook(request(messageUpdate), {
      ...base,
      claim: vi.fn(async () => {
        order.push('claim')
        return { completed: false as const, envelopeKey: key, checkRateLimit: true }
      }),
      getOrCreateConversation: vi.fn(() => {
        order.push('conversation-start')
        return conversation
      }) as never,
      attachConversation: attachConversation as never,
      rateLimit: vi.fn(() => {
        order.push('rate-start')
        return rate
      }) as never,
      trigger,
    })

    for (let index = 0; index < 8; index += 1) await Promise.resolve()
    expect(order).toEqual(['claim', 'conversation-start', 'rate-start'])
    expect(attachConversation).not.toHaveBeenCalled()
    expect(trigger).not.toHaveBeenCalled()

    resolveConversation({ id: queueKey })
    for (let index = 0; index < 4; index += 1) await Promise.resolve()
    expect(attachConversation).not.toHaveBeenCalled()
    expect(trigger).not.toHaveBeenCalled()

    resolveRate({ success: true, remaining: 1, reset: 0 })
    await dispatch
    expect(order).toEqual(['claim', 'conversation-start', 'rate-start', 'attach', 'trigger'])

    const rateLimit = vi.fn()
    await handleTelegramWebhook(request(messageUpdate), {
      ...base,
      claim: vi.fn(async () => ({
        completed: false as const,
        envelopeKey: key,
        checkRateLimit: false,
      })),
      rateLimit,
      trigger: triggerMock(),
    })
    expect(rateLimit).not.toHaveBeenCalled()
  })

  it('rate-limits prompt callbacks, but exempts consent callbacks', async () => {
    const trigger = triggerMock()
    const rateLimit = vi.fn(async () => ({ success: false, remaining: 0, reset: 1 }))
    await handleTelegramWebhook(request(promptCallbackUpdate), { ...base, rateLimit, trigger })
    expect(rateLimit).toHaveBeenCalledOnce()
    const callbackPayload = telegramPlaintextPayloadSchema.parse(
      openTelegramEnvelope(trigger.mock.calls[0][0].sealedEnvelope, key, '43', queueKey)
    )
    expect(callbackPayload).toMatchObject({
      callbackId: 'callback-1', callbackData: 'prompt:v1:weekend', rateLimited: true,
    })

    const consent = structuredClone(promptCallbackUpdate)
    consent.update_id = 44
    consent.callback_query.data = 'consent:v1:accept'
    const exemptRateLimit = vi.fn()
    await handleTelegramWebhook(request(consent), { ...base, rateLimit: exemptRateLimit, trigger: triggerMock() })
    expect(exemptRateLimit).not.toHaveBeenCalled()
  })

  it('does not spend quota again for a duplicate prompt callback', async () => {
    const trigger = triggerMock()
    const rateLimit = vi.fn(async () => ({ success: true, remaining: 1, reset: 0 }))
    const claim = vi.fn()
      .mockResolvedValueOnce({ completed: false as const, envelopeKey: key, checkRateLimit: true })
      .mockResolvedValueOnce({ completed: true as const })
    await handleTelegramWebhook(request(promptCallbackUpdate), { ...base, claim, rateLimit, trigger })
    await handleTelegramWebhook(request(promptCallbackUpdate), { ...base, claim, rateLimit, trigger })
    expect(rateLimit).toHaveBeenCalledOnce()
    expect(trigger).toHaveBeenCalledOnce()
  })

  it('enqueues an opaque rate-limit response and leaves commands available', async () => {
    const trigger = triggerMock()
    await handleTelegramWebhook(request(messageUpdate), {
      ...base,
      rateLimit: vi.fn(async () => ({ success: false, remaining: 0, reset: 1 })),
      trigger,
    })
    const payload = trigger.mock.calls[0][0]
    const plaintext = telegramPlaintextPayloadSchema.parse(
      openTelegramEnvelope(payload.sealedEnvelope, key, payload.updateId, payload.queueKey)
    )
    expect(plaintext).toMatchObject({ rateLimited: true })
    expect(plaintext.text).toBeUndefined()

    const command = structuredClone(messageUpdate)
    command.message.text = '/delete'
    const rateLimit = vi.fn()
    await handleTelegramWebhook(request(command), { ...base, rateLimit, trigger })
    expect(rateLimit).not.toHaveBeenCalled()
  })

  it('acknowledges unsupported and completed updates, but retries failed dispatch', async () => {
    const trigger = triggerMock()
    const unsupported = { ...messageUpdate, edited_message: messageUpdate.message, message: undefined }
    expect((await handleTelegramWebhook(request(unsupported), { ...base, trigger })).status).toBe(200)
    expect(trigger).not.toHaveBeenCalled()

    const completedRateLimit = vi.fn()
    const getOrCreateConversation = vi.fn()
    expect(
      (await handleTelegramWebhook(request(messageUpdate), {
        ...base,
        claim: vi.fn(async () => ({ completed: true as const })),
        getOrCreateConversation,
        rateLimit: completedRateLimit,
        trigger,
      })).status
    ).toBe(200)
    expect(trigger).not.toHaveBeenCalled()
    expect(completedRateLimit).not.toHaveBeenCalled()
    expect(getOrCreateConversation).not.toHaveBeenCalled()

    const markFailed = vi.fn(async () => undefined)
    const failed = vi.fn(async (_payload: TelegramTaskPayload, _options: TriggerOptions) => {
      throw new Error('offline')
    })
    expect(
      (await handleTelegramWebhook(request(messageUpdate), { ...base, markFailed, trigger: failed })).status
    ).toBe(503)
    expect(markFailed).toHaveBeenCalledWith('42', 'dispatch_failed')
  })
})
