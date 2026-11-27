import { getDiscoveryVenues } from '#shared/lib/db/client.server.ts'
import { barriosBySlug, currentPlaceEvents, eventsByVenue, eventsForBarrioIndex, selectBarrio, venuesBySlug } from '../lib/place-pages.ts'
import { getSiteUrl } from '#shared/lib/utils/url.ts'
import { agendaPages, lastmod, selectAgendaPage } from '../lib/agenda-pages.ts'
import { aboutPaths } from './about-page.server.ts'
import { readDiscoveryAgenda } from './read-agenda.server.ts'

export async function readDiscoverySitemapUrls(asOf: Date) {
  const [snapshot, venues] = await Promise.all([readDiscoveryAgenda(asOf), getDiscoveryVenues()])
  const site = getSiteUrl()
  const agendas = Object.entries(agendaPages).map(([path, definition]) => {
    const selection = selectAgendaPage(snapshot, definition)
    return { loc: site + path, lastmod: lastmod([...selection.current, ...selection.later]) }
  })
  const byVenue = eventsByVenue(currentPlaceEvents(snapshot))
  const barrios = [...barriosBySlug].map(([slug, barrio]) => ({
    loc: `${site}/agenda/barrio/${slug}`, lastmod: lastmod(selectBarrio(snapshot, barrio).current),
  }))
  return [
    ...agendas,
    ...aboutPaths.map(path => ({ loc: site + path })),
    { loc: `${site}/agenda/barrios`, lastmod: lastmod(eventsForBarrioIndex(snapshot)) },
    ...barrios,
    ...[...venuesBySlug(venues)].flatMap(([slug, venue]) => {
      const events = byVenue.get(venue.id)
      return events?.length ? [{ loc: `${site}/lugares/${slug}`, lastmod: lastmod(events) }] : []
    }),
  ]
}
