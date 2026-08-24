import { describe, expect, it, vi } from 'vitest'
import { createTelegramClient, TelegramApiError } from './client.ts'

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
      keyboard: [[{ text: 'Events tonight' }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.telegram.org/bot123:secret/sendMessage')
    expect(JSON.parse(String(init?.body))).toEqual({
      chat_id: '99',
      text: 'hello',
      reply_markup: {
        keyboard: [[{ text: 'Events tonight' }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    })
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
})
