const memory = new Map<string, { expiresAt: number; value: unknown }>()

/** Private, anonymous-source observations only. Never cache auth/cookie headers. */
export async function readAcquisitionCache<T>(key: string): Promise<T | undefined> {
  const cached = memory.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value as T
  memory.delete(key)
  return undefined
}

export async function writeAcquisitionCache(key: string, value: unknown, ttlMs: number): Promise<void> {
  // shortcut: a retry in a new isolate re-fetches; move to R2 if this becomes expensive.
  if (memory.size >= 256) memory.delete(memory.keys().next().value!)
  memory.set(key, { expiresAt: Date.now() + ttlMs, value })
}
