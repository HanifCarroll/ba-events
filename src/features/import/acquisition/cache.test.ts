import { expect, it } from 'vitest'
import { readAcquisitionCache, writeAcquisitionCache } from './cache.ts'

it('reuses fresh anonymous observations and expires old ones', async () => {
  await writeAcquisitionCache('fresh', { source: 'synthetic' }, 60000)
  await writeAcquisitionCache('expired', { source: 'old' }, -1)
  expect(await readAcquisitionCache('fresh')).toEqual({ source: 'synthetic' })
  expect(await readAcquisitionCache('expired')).toBeUndefined()
})
