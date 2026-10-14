import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import type { Browser } from 'playwright'
import { reuseAcquisition, reuseCatalogAcquisition, reuseDailyAcquisition, serializeAcquisition, withAcquisitionRun, withOwnedBrowser } from './run.ts'

const previousMode = process.env.NODE_ENV
beforeAll(() => { process.env.NODE_ENV = 'test' })
afterAll(() => {
  if (previousMode === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = previousMode
})

describe('acquisition lifecycle and retry identity', () => {
  it('retains catalog receipts including empty catalogs across retries, and refreshes new runs', async () => {
    for (const events of [[], [{ id: 'event' }]]) {
      const id = crypto.randomUUID()
      let calls = 0
      const acquire = () => reuseCatalogAcquisition('catalog', async () => { calls++; return events })
      const first = await withAcquisitionRun(id, acquire)
      const retried = await withAcquisitionRun(id, acquire)
      expect(first.events).toEqual(events)
      expect(Number.isFinite(Date.parse(first.observedAt!))).toBe(true)
      expect(retried).toEqual(first)
      expect(calls).toBe(1)
      await withAcquisitionRun(crypto.randomUUID(), acquire)
      expect(calls).toBe(2)
    }
  })

  it('reuses legacy raw catalogs with unknown age and keeps their format compatible', async () => {
    const id = crypto.randomUUID()
    const events = [{ id: 'legacy' }]
    await withAcquisitionRun(id, () => reuseAcquisition('legacy-catalog', async () => events))
    let reads = 0
    const record = await withAcquisitionRun(id, () => reuseCatalogAcquisition('legacy-catalog', async () => { reads++; return [] }))
    expect(record).toEqual({ events, observedAt: null })
    expect(reads).toBe(0)
    expect(await withAcquisitionRun(id, () => reuseAcquisition('legacy-catalog', async () => []))).toEqual(events)
  })
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
    const source = () => reuseDailyAcquisition(key, async () => { reads++; return { description: 'Source-backed description', sourceObservedAt: '2026-10-01T10:00:00.000Z' } })
    const first = await withAcquisitionRun(crypto.randomUUID(), source)
    const reused = await withAcquisitionRun(crypto.randomUUID(), source)
    expect(reused).toEqual(first)
    expect(reused.sourceObservedAt).toBe('2026-10-01T10:00:00.000Z')
    expect(reads).toBe(1)
  })

})
