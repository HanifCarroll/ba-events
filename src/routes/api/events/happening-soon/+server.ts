import { addHours } from 'date-fns'
import { readHomeFeed, homeFeedOptions } from '#features/events/api/home-feed.server.ts'
import { HOME_FEED_HEADERS, toCompactHomeCard } from '#features/events/lib/home-feed.ts'
import { apiList } from '#shared/lib/api-response.ts'
import type { RequestHandler } from './$types'

/** The compact public endpoint remains available for existing callers. */
export const GET: RequestHandler = async ({ platform }) => {
  try {
    const { window, events } = await readHomeFeed(homeFeedOptions(platform))
    const earliest = addHours(new Date(), 12).toISOString()
    const cards = events.filter(event => event.starts_at >= earliest && event.starts_at < window.end).slice(0, 4).map(toCompactHomeCard)
    return Response.json(apiList(cards, cards.length), { headers: HOME_FEED_HEADERS })
  } catch {
    return Response.json(apiList([], 0), { headers: { 'Cache-Control': 'no-store' } })
  }
}
