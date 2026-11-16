import { describe, expect, it } from 'vitest'
import { catchupMaxBatches, catchupStatusesForBatch, dailyMaxBatches, shouldChainCatchupBatch } from './enrichment.ts'

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

  it('sizes both chains to the observed backlog with the old floors', () => {
    expect(catchupMaxBatches(10)).toBe(20)
    expect(catchupMaxBatches(2000)).toBe(41)
    expect(dailyMaxBatches(5)).toBe(10)
    expect(dailyMaxBatches(1500)).toBe(16)
  })
})
