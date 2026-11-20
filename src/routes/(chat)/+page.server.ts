import type { PageServerLoad } from './$types'
import { readHomeFeed, homeFeedOptions } from '#features/events/api/home-feed.server.ts'
import { nextHomeViewChange, pageHomeView, parseHomeFilter, selectHomeCollage, selectHomeView } from '#features/events/lib/home-feed.ts'

export const load = (async ({ platform, depends, url }) => {
  depends('ba:home-agenda')
  const filter = parseHomeFilter(url.searchParams.get('f'))
  const requested = url.searchParams.get('n')
  try {
    const agenda = await readHomeFeed(homeFeedOptions(platform))
    return { homeAgenda: {
      day: agenda.window.day,
      view: pageHomeView(selectHomeView(agenda, filter), requested),
      flyers: selectHomeCollage(agenda),
      refreshInMs: nextHomeViewChange(agenda, agenda.asOf) - agenda.asOf,
    } }
  } catch (cause) {
    console.error('Homepage agenda read failed:', cause)
    return { homeAgenda: null }
  }
}) satisfies PageServerLoad
