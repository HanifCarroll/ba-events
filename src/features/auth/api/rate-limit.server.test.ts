import { expect, it, vi } from 'vitest'
import { useD1Binding } from '#shared/lib/db/d1-binding.server.ts'
import { checkApiRateLimit, checkRateLimit, RateLimitUnavailableError } from './rate-limit.server.ts'

for (const check of [checkRateLimit, checkApiRateLimit]) {
  it(`${check.name} fails closed at the deadline when D1 is stalled`, async () => {
    vi.useFakeTimers()
    const batch = vi.fn(() => new Promise(() => {}))
    const prepare = () => ({ bind: () => ({}) })
    useD1Binding({ DB: { prepare, batch } })
    try {
      const checkResult = check('203.0.113.1').catch(error => error)
      expect(batch).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(3000)
      expect(await checkResult).toBeInstanceOf(RateLimitUnavailableError)
    } finally {
      useD1Binding(undefined)
      vi.useRealTimers()
    }
  })
}

it('fails closed without a database binding', async () => {
  useD1Binding(undefined)
  await expect(checkApiRateLimit('203.0.113.1')).rejects.toBeInstanceOf(RateLimitUnavailableError)
})
