import { describe, expect, it } from 'vitest'
import { createBrowserRelease } from './release.ts'

describe('browser release ownership', () => {
  it('coalesces concurrent cleanup and never releases a confirmed session again', async () => {
    let finish!: () => void
    let calls = 0
    const close = createBrowserRelease(() => { calls++; return new Promise<void>(resolve => { finish = resolve }) })
    const first = close()
    expect(close()).toBe(first)
    await Promise.resolve()
    finish()
    await first
    await close()
    expect(calls).toBe(1)
  })

  it('allows later cleanup to verify a previously unconfirmed release', async () => {
    let calls = 0
    const close = createBrowserRelease(async () => { if (++calls === 1) throw new Error('verification unavailable') })
    await expect(close()).rejects.toThrow('verification unavailable')
    await close()
    await close()
    expect(calls).toBe(2)
  })
})
