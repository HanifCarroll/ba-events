import { describe, expect, it, vi } from 'vitest'
import { TelegramApiError } from '#features/telegram/client.ts'
import { retryTelegram } from './telegram-update.ts'

describe('Telegram delivery retry', () => {
  it('honors the full positive retry_after once', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new TelegramApiError('rate limited', 429, 75))
      .mockResolvedValueOnce('sent')
    const waitFor = vi.fn(async () => undefined)

    await expect(retryTelegram(operation, waitFor)).resolves.toBe('sent')
    expect(waitFor).toHaveBeenCalledWith(75)
    expect(operation).toHaveBeenCalledTimes(2)
  })
})
