import type { ChatEventPayload } from '#shared/lib/types.ts'

/** Only public fields actually rendered by the four homepage cards. */
export type HomeEventCard = Pick<ChatEventPayload,
  'id' | 'name' | 'starts_at' | 'time_tba' | 'image_url' | 'image_width' | 'image_height' |
  'venue_name' | 'venue_neighborhood' | 'price' | 'is_free'>

export type HomeEventFeed = HomeEventCard[] | Promise<HomeEventCard[]>

export const HOME_FEED_FRESH_SECONDS = 60
export const HOME_FEED_STALE_SECONDS = 300
export const HOME_FEED_HEADERS = {
  // Explicit no-cache prevents the zone's minimum browser TTL from extending freshness.
  'Cache-Control': 'no-cache',
  'CDN-Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
  'Cloudflare-CDN-Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
}
