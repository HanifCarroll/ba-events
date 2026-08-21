import { describe, expect, it, vi } from 'vitest'
import { purgeGuestLifecycleRetention } from './purge-guest-lifecycle-retention.ts'

describe('guest lifecycle retention', () => {
  it('purges lifecycle rows and guest transcript copies', async () => {
    const lt = vi
      .fn()
      .mockResolvedValueOnce({ error: null, count: 2 })
      .mockResolvedValueOnce({ error: null, count: 3 })
    const client = {
      from: vi.fn(() => ({ delete: vi.fn(() => ({ lt })) })),
    }
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(purgeGuestLifecycleRetention(client as never)).resolves.toEqual({
      purged: 5,
    })
    expect(client.from).toHaveBeenNthCalledWith(1, 'guest_request_lifecycle')
    expect(client.from).toHaveBeenNthCalledWith(2, 'guest_chat_debug')
  })

  it('throws when the purge fails so Trigger retries the run', async () => {
    const error = { message: 'database unavailable' }
    const lt = vi.fn().mockResolvedValue({ error, count: null })
    const deleteRows = vi.fn(() => ({ lt }))
    const client = { from: vi.fn(() => ({ delete: deleteRows })) }
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(purgeGuestLifecycleRetention(client as never)).rejects.toThrow(
      'Guest lifecycle retention failed: database unavailable'
    )
  })
})
