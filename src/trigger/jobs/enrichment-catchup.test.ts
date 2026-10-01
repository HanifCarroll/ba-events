import { describe, expect, it, vi } from 'vitest'

vi.mock('@trigger.dev/sdk/v3', () => ({
  metadata: { set: vi.fn() },
  queue: (definition: unknown) => definition,
  schedules: { task: (definition: unknown) => definition },
  task: (definition: unknown) => definition,
  tasks: { trigger: vi.fn() },
}))

import { catchupStatusesForBatch, shouldChainCatchupBatch } from './enrichment-catchup.ts'

describe('catch-up batch selection', () => {
  it('retries failed events only in the first batch of a chain', () => {
    expect(catchupStatusesForBatch(1)).toEqual(['pending', 'failed'])
    expect(catchupStatusesForBatch(2)).toEqual(['pending'])
    expect(catchupStatusesForBatch(20)).toEqual(['pending'])
  })

  it('chains only while unattempted pending events remain', () => {
    expect(shouldChainCatchupBatch(0, 1, 20)).toBe(false)
    expect(shouldChainCatchupBatch(1, 1, 20)).toBe(true)
    expect(shouldChainCatchupBatch(1, 20, 20)).toBe(false)
  })
})
