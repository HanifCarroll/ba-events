import { describe, it, expect } from 'vitest'
import type { Browser } from 'playwright'
import { reuseAcquisition, reuseDailyAcquisition, serializeAcquisition, withAcquisitionRun, withOwnedBrowser } from './run.ts'

describe('acquisition lifecycle and retry identity', () => {
  it('reuses a completed source read across downstream failure and the same run retry, but refreshes a new daily run', async () => {
    const id = crypto.randomUUID(); let acquisitions = 0
    const source = () => reuseAcquisition('source', async () => ++acquisitions)
    await expect(withAcquisitionRun(id, async () => { await source(); throw new Error('database failed') })).rejects.toThrow('database failed')
    expect(await withAcquisitionRun(id, source)).toBe(1)
    expect(await withAcquisitionRun(crypto.randomUUID(), source)).toBe(2)
  })
  it('does not retain failed acquisitions and closes one shared browser on downstream failure', async () => {
    let calls = 0; let opened = 0; let closed = 0
    await expect(withAcquisitionRun(crypto.randomUUID(), async () => {
      const browser = { isConnected: () => true } as Browser
      const open = async () => { opened++; return { browser, openedAt: Date.now(), pagesUsed: 0, close: async () => { closed++ } } }
      await Promise.all([0, 1].map(() => serializeAcquisition('protected', () => withOwnedBrowser('browser', open, async () => {}))))
      await expect(reuseAcquisition('failed', async () => { calls++; throw new Error('challenge') })).rejects.toThrow('challenge')
      await reuseAcquisition('failed', async () => { calls++; return 'recovered' })
      throw new Error('AI failed')
    })).rejects.toThrow('AI failed')
    expect({ calls, opened, closed }).toEqual({ calls: 2, opened: 1, closed: 1 })
  })
  it('reuses a successful protected detail in a different same-day catch-up run', async () => {
    let reads = 0
    const key = `protected-detail:${crypto.randomUUID()}`
    const source = () => reuseDailyAcquisition(key, async () => { reads++; return 'Source-backed description' })
    await withAcquisitionRun(crypto.randomUUID(), source)
    await withAcquisitionRun(crypto.randomUUID(), source)
    expect(reads).toBe(1)
  })

})
