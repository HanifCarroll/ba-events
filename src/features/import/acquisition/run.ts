import { AsyncLocalStorage } from 'node:async_hooks'
import type { Browser } from 'playwright'
import { readAcquisitionCache, writeAcquisitionCache } from './cache.ts'

export interface OwnedBrowser { browser: Browser; close: () => Promise<void>; openedAt: number; pagesUsed: number }
interface AcquisitionRun {
  id: string
  browsers: Map<string, Promise<OwnedBrowser>>
  pending: Map<string, Promise<unknown>>
  lanes: Map<string, Promise<unknown>>
}
const runs = new AsyncLocalStorage<AcquisitionRun>()
const RETRY_CACHE_MS = 48 * 60 * 60 * 1000

/** Trigger run identity stays stable across attempts; a new daily run gets fresh reads. */
export async function withAcquisitionRun<T>(id: string, work: () => Promise<T>): Promise<T> {
  const run: AcquisitionRun = { id, browsers: new Map(), pending: new Map(), lanes: new Map() }
  return runs.run(run, async () => {
    let workError: unknown
    try { return await work() } catch (error) { workError = error; throw error } finally {
      const closures = await Promise.allSettled([...run.browsers.values()].map(async pending => (await pending).close()))
      if (closures.some(result => result.status === 'rejected')) {
        console.error('[acquisition] Browser cleanup could not be confirmed')
        if (!workError) throw new Error('Acquisition browser cleanup could not be confirmed')
      }
    }
  })
}

export async function reuseAcquisition<T>(key: string, acquire: () => Promise<T>): Promise<T> {
  const run = runs.getStore()
  if (!run) return acquire()
  const existing = run.pending.get(key)
  if (existing) return existing as Promise<T>
  const task = (async () => {
    const cacheKey = `run:${run.id}:${key}`
    const cached = await readAcquisitionCache<T>(cacheKey)
    if (cached !== undefined) return cached
    const value = await acquire()
    await writeAcquisitionCache(cacheKey, value, RETRY_CACHE_MS)
    return value
  })()
  run.pending.set(key, task)
  try { return await task } catch (error) { run.pending.delete(key); throw error }
}

export interface CatalogAcquisition<T> {
  events: T[]
  observedAt: string | null
}

/** Preserve the receipt with the cached catalog, including successful empty catalogs. */
export async function reuseCatalogAcquisition<T>(key: string, acquire: () => Promise<T[]>): Promise<CatalogAcquisition<T>> {
  const run = runs.getStore()
  // Separate namespace keeps original array caches compatible with older workers.
  return reuseAcquisition(`${key}:observed-v1`, async () => {
    const legacy = run ? await readAcquisitionCache<T[]>(`run:${run.id}:${key}`) : undefined
    if (legacy !== undefined) return { events: legacy, observedAt: null }
    return { events: await acquire(), observedAt: new Date().toISOString() }
  })
}

export async function serializeAcquisition<T>(lane: string, work: () => Promise<T>): Promise<T> {
  const run = runs.getStore()
  if (!run) return work()
  const previous = run.lanes.get(lane) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(work)
  run.lanes.set(lane, next)
  return next
}

export async function withOwnedBrowser<T>(key: string, open: () => Promise<OwnedBrowser>, work: (browser: Browser) => Promise<T>): Promise<T> {
  const run = runs.getStore()
  if (!run) {
    const owned = await open()
    try { return await work(owned.browser) } finally { await owned.close() }
  }
  let pending = run.browsers.get(key)
  if (pending) {
    const owned = await pending
    if (!owned.browser.isConnected() || owned.pagesUsed >= 32 || Date.now() - owned.openedAt > 8 * 60 * 1000) {
      await owned.close()
      run.browsers.delete(key)
      pending = undefined
    }
  }
  if (!pending) {
    pending = open()
    run.browsers.set(key, pending)
    pending.catch(() => run.browsers.delete(key))
  }
  const owned = await pending
  owned.pagesUsed++
  return work(owned.browser)
}

export async function withTemporaryBrowser<T>(open: () => Promise<OwnedBrowser>, work: (browser: Browser) => Promise<T>): Promise<T> {
  const owned = await open()
  try { return await work(owned.browser) } finally { await owned.close() }
}

/** A successful protected detail may be reused by same-day catch-up after a DB/AI failure. */
export async function reuseDailyAcquisition<T>(key: string, acquire: () => Promise<T>): Promise<T> {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
  const cacheKey = `daily:${day}:${key}`
  return reuseAcquisition(key, async () => {
    const cached = await readAcquisitionCache<T>(cacheKey)
    if (cached !== undefined) return cached
    const value = await acquire()
    await writeAcquisitionCache(cacheKey, value, RETRY_CACHE_MS)
    return value
  })
}
