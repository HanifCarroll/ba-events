import { describe, expect, it, vi } from 'vitest'
import { purgeTelegramRetention } from './retention.ts'

function deletion(count: number, error: unknown = null) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {}
  query.delete = vi.fn(() => query)
  query.eq = vi.fn(() => query)
  query.lt = vi.fn(async () => ({ error, count }))
  return query
}

describe('Telegram retention', () => {
  it('purges only Telegram conversations and delivery claims older than 30 days', async () => {
    const conversations = deletion(2)
    const updates = deletion(3)
    const client = {
      from: vi.fn((table: string) => (table === 'conversations' ? conversations : updates)),
    } as never

    await expect(
      purgeTelegramRetention(client, new Date('2026-08-31T00:00:00Z'))
    ).resolves.toEqual({ conversations: 2, updates: 3 })

    const cutoff = '2026-08-01T00:00:00.000Z'
    expect(conversations.eq).toHaveBeenCalledWith('channel', 'telegram')
    expect(conversations.lt).toHaveBeenCalledWith('created_at', cutoff)
    expect(updates.lt).toHaveBeenCalledWith('received_at', cutoff)
  })

  it('fails instead of silently skipping a purge error', async () => {
    const client = { from: vi.fn(() => deletion(0, { message: 'offline' })) } as never
    await expect(purgeTelegramRetention(client)).rejects.toThrow(
      'Telegram conversation retention failed'
    )
  })
})
