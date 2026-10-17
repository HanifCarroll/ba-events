import type { PageServerLoad } from './$types'
import { readHomeFeed, homeFeedOptions } from '#features/events/api/home-feed.server.ts'

export const load: PageServerLoad = async ({ platform }) => {
  const feed = await readHomeFeed(homeFeedOptions(platform))
  return { happeningSoonEvents: 'events' in feed ? feed.events : feed.pending }
}
