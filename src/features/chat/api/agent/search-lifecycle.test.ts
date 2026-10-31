import { describe, expect, it } from 'vitest'
import { createSearchLifecycle } from './search-lifecycle.ts'
import type { SearchRetryBoundary } from '../tools/search-retry.ts'

describe('concierge search lifecycle', () => {
  it('admits only one search at a time and seals the policy after a nonempty success', () => {
    const policy = createSearchLifecycle()
    const admitted = policy.begin()
    if ('error' in admitted) throw new Error(admitted.error)
    expect(policy.begin()).toEqual({ error: 'search_in_progress' })
    policy.complete(admitted.attempt, true)
    policy.fail(admitted.attempt)
    expect(policy.begin()).toEqual({ error: 'search_already_succeeded' })
  })

  it('ignores a cancelled attempt after a replacement search starts', () => {
    const policy = createSearchLifecycle()
    const first = policy.begin()
    if ('error' in first) throw new Error(first.error)
    policy.fail(first.attempt)
    const second = policy.begin()
    if ('error' in second) throw new Error(second.error)
    policy.complete(first.attempt, true)
    policy.fail(first.attempt)
    expect(policy.begin()).toEqual({ error: 'search_in_progress' })
    policy.complete(second.attempt, false)
    expect(policy.begin()).not.toHaveProperty('error')
  })

  it('retains an independent copy of the first effective retry constraints', () => {
    const policy = createSearchLifecycle()
    const first = policy.begin()
    if ('error' in first) throw new Error(first.error)
    const boundary: SearchRetryBoundary = { must: { maxPrice: 1000 }, excludedGenres: ['techno'], happeningNow: false }
    policy.complete(first.attempt, false, boundary)
    boundary.must.maxPrice = 5000
    const second = policy.begin()
    if ('error' in second) throw new Error(second.error)
    expect(second.boundary?.must.maxPrice).toBe(1000)
    policy.complete(second.attempt, false, { must: {}, excludedGenres: [], happeningNow: false })
    const third = policy.begin()
    if ('error' in third) throw new Error(third.error)
    expect(third.boundary).toEqual({ must: { maxPrice: 1000 }, excludedGenres: ['techno'], happeningNow: false })
  })
})
