import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { openStagingCatalog } from '../../../../evals/lib/staging-catalog.ts'
import { inspectEvents } from '../../../../evals/search/inspect-events.ts'
import { openDogfoodCatalog } from '../../../../scripts/dogfood-chat-catalog.ts'
import { checkRateLimit } from '#features/auth/api/rate-limit.server.ts'
import { lexicalEventSearch, semanticEventSearch } from './client.server.ts'
import { boundD1, useD1Binding } from './d1-binding.server.ts'
import { cloudflareSearchBackend, useCloudflareBindings } from './search-bindings.server.ts'

it('requires an explicit staging target before connecting, and scopes the proxy to the two catalog bindings', async () => {
  let path: string | undefined
  let disposed = false
  const noSql = () => { throw new Error('fixture does not execute SQL') }
  const DB = { prepare: noSql, batch: noSql }
  const VECTORIZE = { query: async () => ({ matches: [], count: 0 }) }
  const connect = async (configPath: string) => {
    path = configPath
    const config = JSON.parse(await readFile(path, 'utf8'))
    expect(config).toEqual({
      name: 'baeventos-eval-staging', account_id: expect.any(String), compatibility_date: expect.any(String),
      d1_databases: [{ binding: 'DB', database_name: 'baeventos-staging', database_id: expect.any(String), remote: true }],
      vectorize: [{ binding: 'VECTORIZE', index_name: 'baeventos-events-staging', remote: true }],
    })
    return { env: { DB, VECTORIZE }, dispose: async () => { disposed = true } }
  }
  await expect(openStagingCatalog('--production', connect)).rejects.toThrow('--staging')
  expect(path).toBeUndefined()
  {
    await using staging = await openStagingCatalog('--staging', connect)
    expect(cloudflareSearchBackend()).toEqual({ db: DB, vectorize: VECTORIZE })
    expect(boundD1()).toBe(DB)
    expect(await semanticEventSearch('music', {}, 5, undefined, { embedQuery: async () => [1] })).toEqual([])
  }
  expect(disposed).toBe(true)
  expect(path && existsSync(path)).toBe(false)
  expect(boundD1()).toBeNull()
  expect(() => cloudflareSearchBackend()).toThrow('Missing DB binding')
})

it('opens staging bindings before inspecting the catalog for golden labels', async () => {
  const fixture = await openDogfoodCatalog(new Date('2030-02-01T00:00:00.000Z'))
  let opened = false
  let disposed = false
  const connect = async () => {
    opened = true
    return { env: fixture.env, dispose: async () => { disposed = true } }
  }
  try {
    await expect(inspectEvents(undefined, connect)).rejects.toThrow('--staging')
    expect(opened).toBe(false)
    const events = await inspectEvents('--staging', connect)
    expect(events).toHaveLength(6)
    expect(events[0]).toMatchObject({ name: 'Concierto de prueba 1', is_free: true })
    expect(disposed).toBe(true)
    expect(() => cloudflareSearchBackend()).toThrow('Missing DB binding')
  } finally {
    await fixture.dispose()
  }
}, 65_000)

it('serves dogfood guest admission and hydrated event search with local bindings', async () => {
  const fixture = await openDogfoodCatalog(new Date('2030-02-01T00:00:00.000Z'))
  useD1Binding(fixture.env)
  useCloudflareBindings(fixture.env)
  try {
    expect(await checkRateLimit('203.0.113.1')).toMatchObject({ success: true, remaining: 49 })
    const filters = { startsAfter: '2030-02-01T00:00:00.000Z', startsBefore: '2030-02-03T00:00:00.000Z' }
    const dense = await semanticEventSearch('música', filters, 5, undefined, { embedQuery: async () => [1, 0] })
    const lexical = await lexicalEventSearch('música', filters, 5)
    expect(dense.map(row => row.name)).toEqual(['Concierto de prueba 1'])
    expect(lexical.map(row => row.name)).toEqual(['Concierto de prueba 1'])
  } finally {
    useD1Binding(null)
    useCloudflareBindings(null)
    await fixture.dispose()
  }
}, 65_000)
