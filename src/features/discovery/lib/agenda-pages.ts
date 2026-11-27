import { formatInTimeZone } from 'date-fns-tz'
import { enUS, es } from 'date-fns/locale'
import { BA_TIMEZONE } from '#shared/lib/constants.ts'
import { agendaDisplayDay, groupOccurrences, isFreeAdmission, selectHomeEvents, type HomeFilter, type HomeWindow } from '#features/events/lib/home-feed.ts'
import type { AgendaListing } from '#shared/lib/db/event-reads-d1.server.ts'
import type { AgendaCopy } from './copy.ts'
import dates from './date-copy.json'
import topics from './topic-copy.json'
import { genreLabels, topicRules, type AgendaTopic } from './agenda-topics.ts'

export type DiscoverySnapshot = { window: HomeWindow; events: AgendaListing[]; asOf: number }
export type AgendaDefinition = { copy: AgendaCopy; filter: HomeFilter | null; lang: 'es' | 'en'; topic?: AgendaTopic }

function topicDefinition(topic: AgendaTopic, copy: AgendaCopy): AgendaDefinition {
  return { topic, copy, filter: topic === 'musica-en-vivo' ? 'musica' : null, lang: 'es' }
}
export type AgendaSelection = { current: AgendaListing[]; later: AgendaListing[]; next: AgendaListing | undefined }

export const agendaPages: Record<string, AgendaDefinition> = {
  '/agenda/hoy': { copy: dates['/agenda/hoy'], filter: 'hoy', lang: 'es' },
  '/agenda/fin-de-semana': { copy: dates['/agenda/fin-de-semana'], filter: 'finde', lang: 'es' },
  '/agenda/esta-semana': { copy: dates['/agenda/esta-semana'], filter: null, lang: 'es' },
  '/agenda/gratis': { copy: dates['/agenda/gratis'], filter: 'gratis', lang: 'es' },
  '/agenda/teatro': topicDefinition('teatro', topics['/agenda/teatro']),
  '/agenda/musica-en-vivo': topicDefinition('musica-en-vivo', topics['/agenda/musica-en-vivo']),
  '/agenda/ferias': topicDefinition('ferias', topics['/agenda/ferias']),
  '/agenda/muestras': topicDefinition('muestras', topics['/agenda/muestras']),
  '/agenda/poesia': topicDefinition('poesia', topics['/agenda/poesia']),
  '/agenda/tango': topicDefinition('tango', topics['/agenda/tango']),
}

export function selectAgendaPage(snapshot: DiscoverySnapshot, definition: AgendaDefinition): AgendaSelection {
  const { window, events } = snapshot
  const cutoff = definition.filter === 'hoy' ? window.tomorrow : definition.filter === 'finde' ? window.weekendEnd : window.end
  const matches = definition.topic ? topicRules[definition.topic] : () => true
  const future = events.filter(event => event.starts_at >= cutoff && matches(event))
  const limit = Date.parse(window.start) + 60 * 86_400_000 // Buenos Aires currently has no daylight saving time.
  const later = definition.copy.laterHeading ? future.filter(event => Date.parse(event.starts_at) < limit) : []
  return {
    current: selectHomeEvents(snapshot, definition.filter).filter(matches),
    later,
    next: definition.copy.laterHeading ? later[0] : future[0],
  }
}

export function lastmod(events: AgendaListing[]): string | undefined {
  return events.reduce<string | undefined>((latest, { details }) => !latest || details.updated_at > latest ? details.updated_at : latest, undefined)
}

export function listDate(value: Date | string | number, lang: 'es' | 'en' = 'es') {
  return formatInTimeZone(value, BA_TIMEZONE, lang === 'es' ? "EEEE d 'de' MMMM" : 'EEEE, MMMM d', { locale: lang === 'es' ? es : enUS })
}

export function readDate(value: number, lang: 'es' | 'en' = 'es') {
  return formatInTimeZone(value, BA_TIMEZONE, lang === 'es' ? "d 'de' MMMM 'de' yyyy 'a las' HH:mm" : 'MMMM d, yyyy, h:mm aaa',
    { locale: lang === 'es' ? es : enUS }).replace(/\b(am|pm)$/, period => period === 'am' ? 'a.m.' : 'p.m.')
}

export const count = (n: number, singular: string, plural = singular + 's') => `${n} ${n === 1 ? singular : plural}`
export const venueCount = (events: { venue_id: string | null }[]) => new Set(events.flatMap(event => event.venue_id ? [event.venue_id] : [])).size

export function ranked(labels: Iterable<string>) {
  const totals = new Map<string, number>()
  for (const label of labels) totals.set(label, (totals.get(label) ?? 0) + 1)
  return [...totals].sort(([a, n], [b, m]) => m - n || a.localeCompare(b, 'es')).map(([label]) => label)
}

export function agendaCopyValues(snapshot: DiscoverySnapshot, selection: AgendaSelection, sourceCount = 0, topic?: AgendaTopic) {
  const { window, asOf } = snapshot
  const cards = groupOccurrences(selection.current, asOf)
  const free = cards.filter(isFreeAdmission)
  const barrios = ranked(cards.flatMap(event => event.venue_neighborhood ?? [])).slice(0, 3)
  const todayFree = free.filter(event => agendaDisplayDay(event, window.day) === window.day).length
  const genresById = new Map(selection.current.map(event => [event.id, event.details.facets?.genres ?? []]))
  const genres = ranked(cards.flatMap(event => (genresById.get(event.id) ?? []).map(genre => genreLabels[genre]))).slice(0, 3)
  const currentCount = topic === 'teatro' ? count(cards.length, 'función', 'funciones')
    : topic === 'musica-en-vivo' ? count(cards.length, 'fecha') : count(cards.length, 'evento')
  return {
    hoy: listDate(window.start), viernes: listDate(window.weekendStart),
    domingo: listDate(Date.parse(window.weekendEnd) - 1), ultimo_dia: listDate(Date.parse(window.end) - 1),
    n_eventos: currentCount, n_lugares: count(venueCount(cards), 'lugar', 'lugares'),
    n_salas: count(venueCount(cards), 'sala'),
    n_semana: count(cards.length, topic === 'ferias' ? 'feria' : topic === 'muestras' ? 'muestra' : 'fecha'),
    n_gratis: count(free.length, 'evento gratis', 'eventos gratis'), n_cuentas: count(sourceCount, 'cuenta'),
    frase_gratis: !free.length ? undefined : topic === 'musica-en-vivo' ? `${free.length} ${free.length === 1 ? 'es' : 'son'} gratis.`
      : `Hay ${count(free.length, 'evento gratis', 'eventos gratis')}.`,
    generos_top: genres.length === 3 ? new Intl.ListFormat('es').format(genres) : undefined,
    n_gratis_hoy: todayFree ? `Hoy hay ${todayFree}.` : undefined,
    barrios_top: barrios.length === 3 ? new Intl.ListFormat('es').format(barrios) : undefined,
    proxima_fecha: selection.next ? listDate(selection.next.starts_at) : undefined,
    fecha_actualizacion: readDate(asOf),
  }
}
