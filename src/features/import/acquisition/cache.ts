import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Schema } from 'effect'

export const ACQUISITION_BUCKET = 'source-acquisitions'
const entrySchema = Schema.Struct({ version: Schema.Literal(1), expiresAt: Schema.Number, value: Schema.Unknown })
let client: SupabaseClient | undefined
const memory = new Map<string, { expiresAt: number; value: unknown }>()

function storageClient(): SupabaseClient | undefined {
  // Unit tests exercise in-memory reuse; local .env credentials must not cause remote I/O.
  if (process.env.NODE_ENV === 'test') return undefined
  if (client) return client
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return undefined
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  return client
}

export async function cacheObjectKey(key: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
  return `v1/${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}.json`
}

/** Private, anonymous-source observations only. Never cache auth/cookie headers. */
export async function readAcquisitionCache<T>(key: string): Promise<T | undefined> {
  const cached = memory.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value as T
  memory.delete(key)
  const storage = storageClient()
  if (!storage) return undefined
  const { data, error } = await storage.storage.from(ACQUISITION_BUCKET).download(await cacheObjectKey(key)).catch(() => ({ data: null, error: { name: 'NetworkError' } }))
  if (error || !data) return undefined
  try {
    const parsed = Schema.decodeUnknownResult(entrySchema)(JSON.parse(await data.text()))
    if (parsed._tag !== 'Success' || parsed.success.expiresAt <= Date.now()) return undefined
    if (memory.size >= 256) memory.delete(memory.keys().next().value!)
    memory.set(key, parsed.success)
    return parsed.success.value as T
  } catch {
    return undefined
  }
}

export async function writeAcquisitionCache(key: string, value: unknown, ttlMs: number): Promise<void> {
  const entry = { version: 1, expiresAt: Date.now() + ttlMs, value }
  // Bound worker memory; the private durable store retains retry observations.
  if (memory.size >= 256) memory.delete(memory.keys().next().value!)
  memory.set(key, entry)
  const storage = storageClient()
  if (!storage) return
  const { error } = await storage.storage.from(ACQUISITION_BUCKET).upload(
    await cacheObjectKey(key), JSON.stringify(entry), { contentType: 'application/json', upsert: true }
  ).catch(() => ({ error: { name: 'NetworkError' } }))
  if (error) console.warn('[acquisition] Durable cache write failed; source acquisition remains available', { code: error.name })
}

/** Delete only this cache namespace, retaining seven days for cross-midnight retries. */
export async function pruneAcquisitionCache(): Promise<void> {
  const storage = storageClient()
  if (!storage) return
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  for (let batch = 0; batch < 5; batch++) {
    const { data, error } = await storage.storage.from(ACQUISITION_BUCKET).list('v1', {
      limit: 1000, sortBy: { column: 'updated_at', order: 'asc' },
    })
    if (error || !data) { console.warn('[acquisition] Cache retention listing failed'); return }
    const stale = data.filter(object => object.updated_at && Date.parse(object.updated_at) < cutoff).map(object => `v1/${object.name}`)
    if (!stale.length) return
    const removed = await storage.storage.from(ACQUISITION_BUCKET).remove(stale)
    if (removed.error) { console.warn('[acquisition] Cache retention removal failed'); return }
    console.info('[acquisition] Expired cache objects removed', { count: stale.length })
    if (stale.length < 1000) return
  }
}
