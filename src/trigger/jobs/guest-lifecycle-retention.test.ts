import { describe, expect, it, vi } from 'vitest'
import { purgeGuestLifecycleRetention } from './purge-guest-lifecycle-retention.ts'

describe('guest lifecycle retention', () => {
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
