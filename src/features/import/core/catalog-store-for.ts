import { boundD1Database } from '#shared/lib/db/d1.server.ts'
import { boundVectorize } from '#shared/lib/db/vector-sync.ts'
import type { CatalogEnv, CatalogStore } from './catalog-store.ts'
import { d1Catalog } from './catalog-store-d1.ts'

/** D1 needs Vectorize with it: a D1 catalog without its index would leave every new event unsearchable. */
export function catalogStoreFor(env: CatalogEnv): CatalogStore {
  const db = boundD1Database(env)
  if (!db) throw new Error('Missing DB binding')
  const vectors = boundVectorize(env)
  if (!vectors) throw new Error('The DB binding needs a VECTORIZE binding too')
  return d1Catalog(db, vectors)
}
