import { expect, it } from 'vitest'
import { purgeGuestLifecycleRetention } from './guest-lifecycle-retention.ts'

it('surfaces a failed guest retention batch', async () => {
  const batch = async () => { throw new Error('database unavailable') }
  await expect(purgeGuestLifecycleRetention({ prepare: () => ({ bind: () => ({}) }), batch } as never)).rejects.toThrow('database unavailable')
})
