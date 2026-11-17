import { afterEach, describe, expect, it, vi } from 'vitest'
import { pruneAcquisitionCache, readAcquisitionCache, writeAcquisitionCache } from './cache.ts'
import { useD1Binding } from '#shared/lib/db/d1-binding.server.ts'

// The cache skips remote storage under NODE_ENV=test, so these cases run as a deployed Worker would, with synthetic
// Supabase credentials and a fetch stub that records every request instead of sending it.
const fakeD1 = { prepare: () => ({}), batch: async () => [] }

afterEach(() => {
  useD1Binding({})
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function workerEnv() {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('SUPABASE_URL', 'https://synthetic.supabase.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service-key')
  const fetch = vi.fn(async () => Response.json({ message: 'stub' }, { status: 404 }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('acquisition cache backend', () => {
  it('never contacts Supabase Storage on a Worker that binds DB, even with Supabase secrets set', async () => {
    const fetch = workerEnv()
    useD1Binding({ DB: fakeD1 })
    await writeAcquisitionCache('d1-key', { html: 'kept' }, 60_000)
    expect(await readAcquisitionCache('d1-key')).toEqual({ html: 'kept' })
    expect(await readAcquisitionCache('d1-missing')).toBeUndefined()
    await pruneAcquisitionCache()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps using Supabase Storage without DB', async () => {
    const fetch = workerEnv()
    await readAcquisitionCache('supabase-missing')
    expect(fetch).toHaveBeenCalled()
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toContain('synthetic.supabase.test/storage/v1/object/source-acquisitions/')
  })
})
