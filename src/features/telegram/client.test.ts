import { describe, expect, it, vi } from 'vitest'
import { createTelegramClient, TelegramApiError, telegramDraftIdFromUpdateId } from './client.ts'

function telegramResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('Telegram Bot API client', () => {
  it('uses injected fetch and sends plain JSON without parse mode', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      telegramResponse({ ok: true, result: { message_id: 1 } }),
    )
    const client = createTelegramClient({ token: '123:secret', fetch: fetchMock as typeof fetch })

    await client.sendMessage('99', 'hello', {
      inline_keyboard: [[{ text: 'Events tonight', callback_data: 'prompt:v1:chill' }]],
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.telegram.org/bot123:secret/sendMessage')
    expect(JSON.parse(String(init?.body))).toEqual({
      chat_id: '99',
      text: 'hello',
      reply_markup: {
        inline_keyboard: [[{ text: 'Events tonight', callback_data: 'prompt:v1:chill' }]],
      },
    })
  })

  it('can remove a legacy reply keyboard', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      telegramResponse({ ok: true, result: { message_id: 1 } }),
    )
    const client = createTelegramClient({ token: '123:secret', fetch: fetchMock as typeof fetch })

    await client.sendMessage('99', 'hello', { remove_keyboard: true })

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      chat_id: '99',
      text: 'hello',
      reply_markup: { remove_keyboard: true },
    })
  })

  it('sends a visible native Telegram draft with bounded fields', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      telegramResponse({ ok: true, result: true }),
    )
    const client = createTelegramClient({ token: '123:secret', fetch: fetchMock as typeof fetch })

    await client.sendMessageDraft('99', telegramDraftIdFromUpdateId('42'), 'Finding events…')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.telegram.org/bot123:secret/sendMessageDraft',
      expect.objectContaining({
        body: JSON.stringify({ chat_id: 99, draft_id: 42, text: 'Finding events…' }),
      }),
    )
    expect(telegramDraftIdFromUpdateId('2147483647')).toBe(1)
    expect(telegramDraftIdFromUpdateId('9223372036854775808')).toBeGreaterThan(0)
  })

  it('rejects non-integer and unsafe draft chat ids', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      telegramResponse({ ok: true, result: true }),
    )
    const client = createTelegramClient({ token: '123:secret', fetch: fetchMock as typeof fetch })

    expect(() => client.sendMessageDraft('not-a-chat', 42, 'Finding events…')).toThrow('safe integer')
    expect(() => client.sendMessageDraft('9007199254740992', 42, 'Finding events…')).toThrow('safe integer')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('limits webhook delivery to pilot update types', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      telegramResponse({ ok: true, result: true }),
    )
    const client = createTelegramClient({ token: '123:secret', fetch: fetchMock as typeof fetch })

    await client.setWebhook('https://baeventos.com/api/telegram', 'webhook-secret')

    const [, init] = fetchMock.mock.calls[0]!
    expect(JSON.parse(String(init?.body))).toEqual({
      url: 'https://baeventos.com/api/telegram',
      allowed_updates: ['message', 'callback_query'],
      secret_token: 'webhook-secret',
    })
  })

  it('exposes flood retry_after and redacts the token from API errors', async () => {
    const token = '123:top-secret'
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      telegramResponse(
        {
          ok: false,
          error_code: 429,
          description: `retry request with ${token}`,
          parameters: { retry_after: 17 },
        },
        429,
      ),
    )
    const client = createTelegramClient({ token, fetch: fetchMock as typeof fetch })

    const error = await client.getWebhookInfo().catch((value: unknown) => value)
    const apiError = error as TelegramApiError

    expect(apiError).toBeInstanceOf(TelegramApiError)
    expect(apiError.errorCode).toBe(429)
    expect(apiError.retryAfter).toBe(17)
    expect(apiError.message).not.toContain(token)
    expect(apiError.message).toContain('[REDACTED]')
  })

  it('redacts tokens from transport failures', async () => {
    const token = '123:transport-secret'
    const client = createTelegramClient({
      token,
      fetch: vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
        throw new Error(`failed https://api.telegram.org/bot${token}/sendMessage`)
      }) as typeof fetch,
    })

    const error = (await client.sendChatAction('1').catch((value: unknown) => value)) as TelegramApiError

    expect(error.message).not.toContain(token)
    expect(error.message).toContain('[REDACTED]')
  })

  it('rejects malformed JSON and envelopes without a result', async () => {
    const malformed = createTelegramClient({
      token: '123:secret',
      fetch: vi.fn(async () => new Response('{not-json', { status: 502 })) as typeof fetch,
    })
    await expect(malformed.getWebhookInfo()).rejects.toThrow('invalid response (502)')

    const missingResult = createTelegramClient({
      token: '123:secret',
      fetch: vi.fn(async () => telegramResponse({ ok: true })) as typeof fetch,
    })
    await expect(missingResult.getWebhookInfo()).rejects.toThrow('invalid response (200)')
  })

  it('rejects invalid envelopes and preserves generic successful results', async () => {
    const invalidEnvelope = createTelegramClient({
      token: '123:secret',
      fetch: vi.fn(async () => telegramResponse({ ok: 'yes', result: true })) as typeof fetch,
    })
    await expect(invalidEnvelope.deleteWebhook()).rejects.toThrow('invalid response (200)')

    const generic = createTelegramClient({
      token: '123:secret',
      fetch: vi.fn(async () => telegramResponse({ ok: true, result: { ok: 'generic' } })) as typeof fetch,
    })
    await expect(generic.sendChatAction('99')).resolves.toEqual({ ok: 'generic' })
  })
})
