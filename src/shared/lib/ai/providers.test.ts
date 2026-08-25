import { describe, expect, it } from 'vitest'
import { shouldUseDeepSeekFlashCanary } from './providers.ts'

describe('DeepSeek canary', () => {
  it('uses the stable telegram:42 bucket and validates percentage boundaries', () => {
    expect(shouldUseDeepSeekFlashCanary('telegram:42', 51)).toBe(false)
    expect(shouldUseDeepSeekFlashCanary('telegram:42', 52)).toBe(true)
    expect(shouldUseDeepSeekFlashCanary('telegram:42', Number.NaN)).toBe(false)
    expect(shouldUseDeepSeekFlashCanary('telegram:42', -1)).toBe(false)
    expect(shouldUseDeepSeekFlashCanary('telegram:42', 0)).toBe(false)
    expect(shouldUseDeepSeekFlashCanary('telegram:42', 100)).toBe(true)
    expect(shouldUseDeepSeekFlashCanary('telegram:42', 101)).toBe(true)
  })
})
