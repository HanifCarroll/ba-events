import type { RequestHandler } from './$types'
import { serveArtwork, type ArtworkBucket, type ArtworkImages } from '#features/events/api/artwork.server.ts'
import { getEventArtwork } from '#shared/lib/db/client.server.ts'
import type { PublicCache } from '#features/events/api/platform-cache.ts'

type ArtworkEnv = { IMAGES?: ArtworkImages; ARTWORK?: ArtworkBucket }

export const GET: RequestHandler = ({ request, params, platform }) => serveArtwork({
  request, id: params.id, variant: params.variant,
  images: (platform as { env?: ArtworkEnv } | undefined)?.env?.IMAGES,
  // R2 artwork, bound on a Worker that binds D1 (staging until the cutover).
  bucket: (platform as { env?: ArtworkEnv } | undefined)?.env?.ARTWORK,
  cache: platform?.caches?.default as unknown as PublicCache | undefined,
  retain: platform?.context ? (task) => platform.context.waitUntil(task) : undefined,
  lookup: getEventArtwork,
  ownedStorageOrigin: process.env.SUPABASE_URL,
})
