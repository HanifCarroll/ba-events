import { describe, expect, it } from 'vitest'
import { withTimeout } from './browserbase.ts'

describe('withTimeout', () => {
  it('resolves with the value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000, 'fast op')).resolves.toBe('ok')
  })

  it('rejects with the original error first', async () => {
    await expect(
      withTimeout(Promise.reject(new Error('original failure')), 1000, 'fast op')
    ).rejects.toThrow('original failure')
  })

  it('rejects with a labelled timeout error when the promise exceeds the bound', async () => {
    await expect(
      withTimeout(new Promise(() => {}), 10, 'slow op')
    ).rejects.toThrow(/slow op timed out after 10ms/)
  })
})
