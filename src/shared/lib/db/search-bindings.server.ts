/** Search and catalog reads use the Worker's D1 and Vectorize bindings. */
import type { D1Database, VectorizeIndex } from '@cloudflare/workers-types'
import { boundD1Database } from './d1.server.ts'

export type SearchBackend = { db: D1Database; vectorize: VectorizeIndex | null }

let backend: SearchBackend | null = null

/** Records the env's `DB` and `VECTORIZE` bindings, or clears them when the env has no `DB`. */
export function useCloudflareBindings(env: unknown): void {
  const db = boundD1Database(env)
  const vectorize = (env as { VECTORIZE?: Partial<VectorizeIndex> } | null | undefined)?.VECTORIZE
  backend = db ? { db, vectorize: typeof vectorize?.query === 'function' ? (vectorize as VectorizeIndex) : null } : null
}

export function cloudflareSearchBackend(): SearchBackend {
  if (!backend) throw new Error('Missing DB binding')
  return backend
}
