import { getSiteUrl } from '#shared/lib/utils/url.ts'
import { agendaPages, lastmod, selectAgendaPage } from '../lib/agenda-pages.ts'
import { readDiscoveryAgenda } from './read-agenda.server.ts'

export async function readDiscoverySitemapUrls(asOf: Date) {
  const snapshot = await readDiscoveryAgenda(asOf)
  const site = getSiteUrl()
  return Object.entries(agendaPages).map(([path, definition]) => {
    const selection = selectAgendaPage(snapshot, definition)
    return { loc: site + path, lastmod: lastmod([...selection.current, ...selection.later]) }
  })
}
