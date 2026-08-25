import { describe, expect, it, vi } from 'vitest'
import {
  TELEGRAM_RECENT_ERROR_AGE_MS,
  TELEGRAM_STALE_FAILURE_AGE_MS,
  countStaleTelegramFailures,
  parseTelegramWebhookInfo,
  runTelegramHealthCheck,
  telegramHealthDecision,
} from './telegram-health.ts'

const now = new Date('2026-08-25T12:00:00Z')
const webhook = { url: 'https://baeventos.com/api/telegram', pending_update_count: 0 }

describe('Telegram health check', () => {
  it('accepts healthy and old-error webhook info, but rejects malformed data', () => {
    expect(parseTelegramWebhookInfo(webhook)).toEqual(webhook)
    expect(telegramHealthDecision({
      ...webhook,
      last_error_date: Math.floor(now.getTime() / 1000) - TELEGRAM_RECENT_ERROR_AGE_MS / 1000 - 1,
    }, 0, now)).toEqual({ healthy: true, reason: 'ok' })
    expect(parseTelegramWebhookInfo({ url: 'http://bad', pending_update_count: 0 })).toBeNull()
    expect(parseTelegramWebhookInfo({ url: 'https://ok', pending_update_count: -1 })).toBeNull()
    expect(parseTelegramWebhookInfo({ url: 'https://ok', pending_update_count: 0, last_error_date: 'bad' })).toBeNull()
    expect(telegramHealthDecision({}, 0, now)).toEqual({ healthy: false, reason: 'malformed_webhook_info' })
  })

  it('reports bounded backlog and recent webhook errors as unhealthy', () => {
    expect(telegramHealthDecision({ ...webhook, pending_update_count: 101 }, 0, now)).toEqual({
      healthy: false,
      reason: 'pending_backlog',
    })
    expect(telegramHealthDecision({
      ...webhook,
      last_error_date: Math.floor(now.getTime() / 1000) - 60,
    }, 0, now)).toEqual({ healthy: false, reason: 'recent_webhook_error' })
  })

  it('distinguishes stale failed rows from recent ones and surfaces DB errors', async () => {
    const cutoff = new Date(now.getTime() - TELEGRAM_STALE_FAILURE_AGE_MS).toISOString()
    const staleQuery = { select: vi.fn(() => ({ eq: vi.fn(() => ({ lt: vi.fn().mockResolvedValue({ count: 2, error: null }) })) })) }
    const recentQuery = { select: vi.fn(() => ({ eq: vi.fn(() => ({ lt: vi.fn().mockResolvedValue({ count: 0, error: null }) })) })) }
    await expect(countStaleTelegramFailures({ from: vi.fn(() => staleQuery) } as never, now)).resolves.toBe(2)
    await expect(countStaleTelegramFailures({ from: vi.fn(() => recentQuery) } as never, now)).resolves.toBe(0)
    expect(staleQuery.select).toHaveBeenCalledWith('update_id', { count: 'exact', head: true })
    expect(telegramHealthDecision(webhook, 1, now)).toEqual({ healthy: false, reason: 'stale_failed_updates' })
    const errorQuery = { select: vi.fn(() => ({ eq: vi.fn(() => ({ lt: vi.fn().mockResolvedValue({ count: null, error: new Error('db down') }) })) })) }
    await expect(countStaleTelegramFailures({ from: vi.fn(() => errorQuery) } as never, now)).rejects.toThrow('Failed to read stale Telegram updates')
    expect(cutoff).toContain('2026-08-25')
  })

  it('throws on unhealthy state while logging only bounded status', async () => {
    await expect(runTelegramHealthCheck(
      { getWebhookInfo: vi.fn().mockResolvedValue({ ...webhook, pending_update_count: 101, last_error_message: 'private content' }) },
      { from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ lt: vi.fn().mockResolvedValue({ count: 0, error: null }) })) })) })) } as never,
      now,
    )).rejects.toThrow('pending_backlog')
  })
})
