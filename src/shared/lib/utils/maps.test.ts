import { describe, expect, it } from 'vitest'
import { shouldOpenMapsInSameTab } from './maps'

describe('shouldOpenMapsInSameTab', () => {
  it('uses the current tab for mobile browsers', () => {
    expect(shouldOpenMapsInSameTab('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', false)).toBe(true)
    expect(shouldOpenMapsInSameTab('Mozilla/5.0 (Linux; Android 15)', false)).toBe(true)
  })

  it('uses the current tab for coarse-pointer devices', () => {
    expect(shouldOpenMapsInSameTab('Mozilla/5.0 (X11; Linux x86_64)', true)).toBe(true)
  })

  it('opens a new tab for desktop browsers with a precise pointer', () => {
    expect(shouldOpenMapsInSameTab('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', false)).toBe(false)
  })
})
