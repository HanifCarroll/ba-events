import { describe, expect, it, vi } from 'vitest'
import { createServiceRoleClient } from '../utils/db-client.ts'
import { guestLifecycleRetention } from './guest-lifecycle-retention.ts'

vi.mock('@trigger.dev/sdk/v3', () => ({
  schedules: { task: vi.fn((definition) => definition) },
}))
vi.mock('../utils/db-client.ts', () => ({ createServiceRoleClient: vi.fn() }))

describe('guest lifecycle retention', () => {
  it('throws when the purge fails so Trigger retries the run', async () => {
    const error = { message: 'database unavailable' }
    const lt = vi.fn().mockResolvedValue({ error, count: null })
    const deleteRows = vi.fn(() => ({ lt }))
    vi.mocked(createServiceRoleClient).mockReturnValue({
      from: vi.fn(() => ({ delete: deleteRows })),
    } as never)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const run = (guestLifecycleRetention as unknown as { run: () => Promise<unknown> }).run
    await expect(run()).rejects.toThrow('Guest lifecycle retention failed: database unavailable')
  })
})
