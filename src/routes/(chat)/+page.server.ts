import type { PageServerLoad } from './$types'
import { readHomeFeed, homeFeedOptions } from '#features/events/api/home-feed.server.ts'

export const load: PageServerLoad = async ({ platform }) => {
  try {
    return { homeAgenda: await readHomeFeed(homeFeedOptions(platform)) }
  } catch (cause) {
    console.error('Homepage agenda read failed:', cause)
    return { homeAgenda: null }
  }
}
