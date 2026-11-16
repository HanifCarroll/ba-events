/**
 * Which backend the shared catalog reads use. Each Worker entry point passes its env here once per request; when the
 * env binds `DB` (the seam in d1.server.ts), search and the event reads around it run on D1 and Vectorize, otherwise
 * they stay on Supabase. Production binds `DB` only at the cutover, so production keeps using Supabase until then.
 * Bindings are per-isolate, not per-request, so holding them in module state is safe.
 */
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

/** The D1 backend when the current Worker binds one, else null (use Supabase). */
export function cloudflareSearchBackend(): SearchBackend | null {
  return backend
}
