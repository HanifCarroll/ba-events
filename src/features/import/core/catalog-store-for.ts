/**
 * The backend seam for the catalog: D1 when the env binds `DB`, else the Supabase service client. Production configs bind
 * neither `DB` nor `VECTORIZE` until the cutover (delivery PR 08), so production keeps using Supabase.
 */
import type { Vectorize } from '@cloudflare/workers-types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { boundD1Database } from '#shared/lib/db/d1.server.ts'
import { supabaseCatalog, type CatalogEnv, type CatalogStore } from './catalog-store.ts'
import { d1Catalog } from './catalog-store-d1.ts'

export function boundVectorize(env: CatalogEnv): Vectorize | null {
  const index = env.VECTORIZE as Partial<Vectorize> | undefined
  return typeof index?.upsert === 'function' && typeof index.getByIds === 'function' ? index as Vectorize : null
}

/** D1 needs Vectorize with it: a D1 catalog without its index would leave every new event unsearchable. */
export function catalogStoreFor(env: CatalogEnv, supabase: () => SupabaseClient): CatalogStore {
  const db = boundD1Database(env)
  if (!db) return supabaseCatalog(supabase())
  const vectors = boundVectorize(env)
  if (!vectors) throw new Error('The DB binding needs a VECTORIZE binding too')
  return d1Catalog(db, vectors)
}
