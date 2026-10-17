import { readHomeFeed, homeFeedOptions } from '#features/events/api/home-feed.server.ts'
import { HOME_FEED_HEADERS } from '#features/events/lib/home-feed.ts'
import { apiList } from '#shared/lib/api-response.ts'
import type { RequestHandler } from './$types'

/** Public, bounded feed for the homepage's below-fold event cards. */
export const GET: RequestHandler = async ({ platform }) => {
 const feed = await readHomeFeed(homeFeedOptions(platform))
 const events = 'events' in feed ? feed.events : await feed.pending
	return Response.json(
		apiList(events, events.length),
   { headers: HOME_FEED_HEADERS }
	)
}
