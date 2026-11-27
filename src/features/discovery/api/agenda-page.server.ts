import { error } from '@sveltejs/kit'
import { getEnabledInstagramSourceCount } from '#shared/lib/db/client.server.ts'
import { getEventUrl, getSiteUrl, resolveSiteUrl } from '#shared/lib/utils/url.ts'
import { groupOccurrences, HOME_FEED_HEADERS, isFreeAdmission, type HomeAgendaCardEvent } from '#features/events/lib/home-feed.ts'
import { buildEventJsonLd } from '#features/events/lib/event-summary.ts'
import { readDiscoveryAgenda } from './read-agenda.server.ts'
import { agendaCopyValues, agendaPages, selectAgendaPage, type DiscoverySnapshot } from '../lib/agenda-pages.ts'
import { fillCopy, pageCopy, type AgendaCopy, type CopyValues } from '../lib/copy.ts'
import type { AgendaListing } from '#shared/lib/db/event-reads-d1.server.ts'

type Section = { heading?: string; cards: HomeAgendaCardEvent[] }

function cardsFor(events: AgendaListing[], asOf: number): HomeAgendaCardEvent[] {
  return groupOccurrences(events.map(({ details: _, ...event }) => event), asOf)
}

export function buildAgendaPage(input: {
  path: string
  lang: 'es' | 'en'
  snapshot: DiscoverySnapshot
  copy: AgendaCopy
  values: CopyValues
  current: AgendaListing[]
  later: AgendaListing[]
  sections?: Section[]
}) {
  const { path, lang, snapshot, copy, values, current, later } = input
  const cards = cardsFor(current, snapshot.asOf)
  const laterCards = cardsFor(later, snapshot.asOf).slice(0, 6)
  const sections = input.sections ?? [
    { cards }, { heading: copy.laterHeading, cards: laterCards },
  ].filter(section => section.cards.length > 0)
  const details = new Map([...current, ...later].map(event => [event.id, event.details]))
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'ItemList',
    itemListElement: sections.flatMap(section => section.cards).map((card, i) => {
      const row = details.get(card.id)
      const item = buildEventJsonLd({ ...card, ...row, source: row?.source ?? 'instagram',
        ticket_url: row?.ticket_url ?? null, status: 'scheduled' }, getEventUrl(card.id), resolveSiteUrl(card.image_url))
      return { '@type': 'ListItem', position: i + 1, item }
    }),
  }
  let intro = cards.length ? copy.intro : laterCards.length ? copy.emptyLater : copy.empty
  if (cards.length && !laterCards.length) intro = intro?.replace(' Más abajo están las próximas fechas.', '')
  if (path === '/agenda/esta-semana' && !cards.some(isFreeAdmission)) intro = intro?.replace(' Hay {{n_gratis}}.', '')
  return {
    day: snapshot.window.day, lang, path, canonical: getSiteUrl() + path, sections, jsonLd,
    ...pageCopy(copy, values),
    intro: fillCopy(intro ?? '', values),
    faq: copy.faq.map(({ question, answer }) => ({ question: fillCopy(question, values), answer: fillCopy(answer, values) })),
  }
}

export type AgendaPageData = ReturnType<typeof buildAgendaPage>

export async function loadAgendaPage(path: string, setHeaders: (headers: Record<string, string>) => void, signedIn: boolean) {
  const definition = Object.hasOwn(agendaPages, path) ? agendaPages[path] : undefined
  if (!definition) error(404, 'Agenda not found')
  const snapshot = await readDiscoveryAgenda()
  const selection = selectAgendaPage(snapshot, definition)
  const sourceCount = path === '/agenda/esta-semana' ? await getEnabledInstagramSourceCount() : 0
  setHeaders(signedIn ? { 'Cache-Control': 'private, no-store' } : HOME_FEED_HEADERS)
  return buildAgendaPage({ path, snapshot, ...definition, ...selection, values: agendaCopyValues(snapshot, selection, sourceCount, definition.topic) })
}

export { cardsFor }
