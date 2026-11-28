import { error } from '@sveltejs/kit'
import { getDiscoveryVenues } from '#shared/lib/db/client.server.ts'
import { getSiteUrl } from '#shared/lib/utils/url.ts'
import { agendaDisplayDay, selectHomeEvents } from '#features/events/lib/home-feed.ts'
import { buildAgendaPage, cardsFor, setDiscoveryHeaders, type DiscoveryInfo } from './agenda-page.server.ts'
import { readDiscoveryAgenda } from './read-agenda.server.ts'
import { count, listDate, readDate, venueCount } from '../lib/agenda-pages.ts'
import { barriosBySlug, barrioPaths, currentPlaceEvents, eventsByVenue, eventsForBarrioIndex, rankBarrios, selectBarrio, venuesBySlug } from '../lib/place-pages.ts'
import copy from '../lib/place-copy.json'

export async function loadBarrioPage(slug: string, setHeaders: (headers: Record<string, string>) => void, signedIn: boolean) {
  const barrio = barriosBySlug.get(slug)
  if (!barrio) error(404, 'Barrio not found')
  const snapshot = await readDiscoveryAgenda()
  const { today, current, next } = selectBarrio(snapshot, barrio)
  const cards = cardsFor(current, snapshot.asOf)
  const todayCards = cardsFor(today, snapshot.asOf)
  const todayIds = new Set(today.map(event => event.id))
  const weekCards = cardsFor(current.filter(event => !todayIds.has(event.id)), snapshot.asOf)
  const other = rankBarrios(cardsFor(selectHomeEvents(snapshot, null), snapshot.asOf), barrio).slice(0, 3)
  const links = new Intl.ListFormat('es').format(other.map(name => `[${name}](${barrioPaths.get(name)})`))
  const page = copy['/agenda/barrio/{slug}']
  const adjusted = !links ? {
    ...page,
    empty: page.empty.replace('lo que hay en {{barrios_vecinos}}, o la', 'la'),
  } : page
  setDiscoveryHeaders(setHeaders, signedIn)
  return buildAgendaPage({
    path: `/agenda/barrio/${slug}`, lang: 'es', snapshot, copy: adjusted, current, later: [],
    values: {
      barrio, n_eventos: count(cards.length, 'evento'), n_lugares: count(venueCount(cards), 'lugar', 'lugares'),
      frase_hoy: todayCards.length ? `Hoy hay ${todayCards.length}.` : `Hoy no hay eventos cargados en ${barrio}.`,
      barrios_vecinos: links || undefined, proxima_fecha: next ? listDate(next.starts_at) : undefined,
      fecha_actualizacion: readDate(snapshot.asOf),
    },
    sections: [
      { heading: page.todayHeading.replace('{{barrio}}', barrio), cards: todayCards },
      { heading: page.weekHeading.replace('{{barrio}}', barrio), cards: weekCards },
    ].filter(section => section.cards.length),
  })
}

function publicWeb(value: string | null): URL | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url : null
  } catch {
    return null
  }
}

export async function loadVenuePage(slug: string, setHeaders: (headers: Record<string, string>) => void, signedIn: boolean) {
  const [snapshot, venues] = await Promise.all([readDiscoveryAgenda(), getDiscoveryVenues()])
  const venue = venuesBySlug(venues).get(slug)
  if (!venue) error(404, 'No encontramos ese lugar.')
  const current = eventsByVenue(currentPlaceEvents(snapshot)).get(venue.id)
  if (!current?.length) error(404, 'No hay eventos próximos en este lugar.')
  const page = copy['/lugares/{slug}']
  const cards = cardsFor(current, snapshot.asOf)
  const first = cards[0]
  const firstDay = agendaDisplayDay(first, snapshot.window.day) === snapshot.window.day ? snapshot.window.start : first.starts_at
  const address = venue.address?.trim()
  const barrio = venue.neighborhood ?? undefined
  const site = publicWeb(venue.website)
  const handle = venue.instagram_handle?.replace(/^@/, '')
  const info: DiscoveryInfo[] = [
    ...(address ? [{ label: 'Dirección', value: address }] : []),
    ...(barrio ? [{ label: 'Barrio', value: barrio, href: barrioPaths.get(barrio) }] : []),
    ...(handle && /^[\w.]+$/.test(handle) ? [{ label: 'Instagram', value: `@${handle}`, href: `https://www.instagram.com/${handle}/` }] : []),
    ...(site ? [{ label: 'Sitio web', value: site.hostname, href: site.href }] : []),
  ]
  setDiscoveryHeaders(setHeaders, signedIn)
  return buildAgendaPage({
      path: `/lugares/${slug}`, lang: 'es', snapshot, current, later: [],
      copy: barrio ? page : { ...page, description: page.description.replace(', {{barrio}}', ''),
        intro: page.intro.replace(', en {{barrio}}', '') },
      values: { venue: venue.name, direccion: address || undefined, barrio,
        n_proximos: count(cards.length, 'evento'), proxima_fecha: listDate(firstDay), fecha_actualizacion: readDate(snapshot.asOf) },
      sections: [{ cards: cards.slice(0, 30) }], info,
  })
}

export async function loadBarrioIndex(setHeaders: (headers: Record<string, string>) => void, signedIn: boolean) {
  const snapshot = await readDiscoveryAgenda()
  const path = '/agenda/barrios'
  const upcoming = cardsFor(eventsForBarrioIndex(snapshot), snapshot.asOf)
  setDiscoveryHeaders(setHeaders, signedIn)
  return {
    lang: 'es' as const, path, canonical: getSiteUrl() + path,
    title: 'Agenda por barrio en Buenos Aires | BA Eventos',
    heading: 'Agenda por barrio en Buenos Aires',
    description: 'Encontrá próximos eventos culturales en los barrios de Buenos Aires.',
    updated: `Actualizado el ${readDate(snapshot.asOf)}`,
    links: rankBarrios(upcoming).map(name => ({ name, href: barrioPaths.get(name) })),
  }
}
