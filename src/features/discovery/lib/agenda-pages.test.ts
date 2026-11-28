import { describe, expect, it } from 'vitest'
import { homeWindow } from '#features/events/lib/home-feed.ts'
import type { AgendaListing } from '#shared/lib/db/event-reads-d1.server.ts'
import { agendaCopyValues, agendaPages, lastmod, selectAgendaPage } from './agenda-pages.ts'
import { fillCopy } from './copy.ts'
import { eventFacetsSchema } from '#shared/lib/search-facets.ts'

function listing(id: string, starts_at: string, extras: Partial<AgendaListing> = {}): AgendaListing {
  return {
    id, name: id, starts_at, ends_at: null, is_all_day: false, time_tba: false, image_url: 'https://example.test/image.png',
    image_width: null, image_height: null, venue_id: null, venue_name: null, venue_neighborhood: null, price: 1000,
    is_free: false, payWhatYouCan: false, location_tba: false, location_hidden: false, music: false, sourceUrl: null,
    details: { source: 'luma', updated_at: starts_at, description_es: null, ticket_url: null }, ...extras,
  }
}

const friday = listing('friday', '2026-11-27T03:00:00.000Z', { ends_at: '2026-11-27T10:00:00.000Z' })
const thursday = listing('thursday', '2026-11-27T02:30:00.000Z', { ends_at: '2026-11-27T03:00:00.000Z' })
const sunday = listing('sunday', '2026-11-30T02:59:59.999Z', { price: 0 })
const monday = listing('monday', '2026-11-30T03:00:00.000Z', { is_free: true, payWhatYouCan: true })
const nextWeek = listing('next-week', '2026-12-04T03:00:00.000Z')
const events = [thursday, friday, sunday, monday, nextWeek]

function fixture(value: string) {
  const date = new Date(value)
  return { window: homeWindow(date), asOf: +date, events }
}

function select(path: string, date = '2026-11-27T03:00:00.000Z') {
  return selectAgendaPage(fixture(date), agendaPages[path])
}

const ids = (rows: AgendaListing[]) => rows.map(row => row.id)

describe('public date agendas', () => {
  it('switches Hoy at Buenos Aires midnight and excludes an event exactly at its end', () => {
    expect(ids(select('/agenda/hoy', '2026-11-27T02:59:59.999Z').current)).toEqual(['thursday'])
    expect(ids(select('/agenda/hoy').current)).toEqual(['friday'])
  })

  it('includes Friday through Sunday, then starts the coming weekend on Monday in Buenos Aires', () => {
    expect(ids(select('/agenda/fin-de-semana').current)).toEqual(['friday', 'sunday'])
    expect(ids(select('/agenda/fin-de-semana', '2026-11-29T03:00:00.000Z').current)).toEqual(['sunday'])
    expect(ids(select('/agenda/fin-de-semana', '2026-11-30T03:00:00.000Z').current)).toEqual(['next-week'])
  })

  it('stops this week at local midnight on day seven', () => {
    const selection = select('/agenda/esta-semana')
    expect(ids(selection.current)).toEqual(['friday', 'sunday', 'monday'])
    expect(selection.next?.id).toBe('next-week')
    expect(lastmod(selection.current)).toBe(monday.details.updated_at)
  })

  it('counts zero-price events as free unless they are pay-what-you-can', () => {
    expect(ids(select('/agenda/gratis').current)).toEqual(['sunday'])
  })

  it('fills real counts and skips unavailable optional sentences without losing surrounding copy', () => {
    const snapshot = fixture('2026-11-27T03:00:00.000Z')
    const definition = agendaPages['/agenda/hoy']
    const values = agendaCopyValues(snapshot, selectAgendaPage(snapshot, definition))
    const intro = fillCopy(definition.copy.intro, values)
    expect(intro).toContain('Hoy, viernes 27 de noviembre, la agenda de BA Eventos tiene 1 evento')
    expect(intro).toContain('Cada ficha muestra horario')
    expect(intro).not.toContain('Hay 0 eventos gratis')
    expect(intro).not.toContain('{{')
  })
})

describe('topic agendas', () => {
  const base = fixture('2026-11-27T03:00:00.000Z')
  const topicListing = (name: string, extra?: Partial<AgendaListing>) => listing(name, '2026-11-27T20:00:00.000Z', extra)
  const withFacet = (name: string, facets: unknown) => topicListing(name, {
    details: { ...friday.details, facets: eventFacetsSchema.parse(facets) },
  })
  const examples = [
    ['teatro', topicListing('Cuarteto', { venue_name: 'Teatro Sintético' }), topicListing('Cine en un centro cultural')],
    ['musica-en-vivo', topicListing('Dúo', { music: true }), topicListing('Fiesta con DJ')],
    ['ferias', topicListing('Féria de libros'), topicListing('Concierto de feriado')],
    ['muestras', withFacet('Instalación', { eventType: ['exhibition'] }), withFacet('Festival', { eventType: ['festival'] })],
    ['poesia', topicListing('Lectura literaria'), topicListing('Lectura de tarot')],
    ['tango', withFacet('Trío Sintético', { genres: ['tango'] }), withFacet('Jazz del Sur', { genres: ['jazz'] })],
  ] as const

  it.each(examples)('includes the supported %s matches and excludes a nearby nonmatch', (slug, yes, no) => {
    expect(ids(selectAgendaPage({ ...base, events: [yes, no] }, agendaPages[`/agenda/${slug}`]).current)).toEqual([yes.id])
  })

  it.each([
    ['teatro', topicListing('Unipersonal de ejemplo')],
    ['poesia', topicListing('Encuentro de ejemplo', { details: { ...friday.details, description_es: 'Una noche de poesía en la sala.' } })],
    ['tango', topicListing('Milonga de ejemplo')],
  ] as const)('includes an independent %s match without relying on its other match path', (topic, match) => {
    const selection = selectAgendaPage({ ...base, events: [match] }, agendaPages[`/agenda/${topic}`])
    expect(ids(selection.current)).toEqual([match.id])
  })

  it('excludes fairs at the local 60-day cutoff but includes one millisecond before', () => {
    const before = listing('Feria editorial anterior', '2027-01-26T02:59:59.999Z')
    const at = listing('Feria editorial en el límite', '2027-01-26T03:00:00.000Z')
    const selection = selectAgendaPage({ ...base, events: [before, at] }, agendaPages['/agenda/ferias'])
    expect(ids(selection.later)).toEqual([before.id])
  })

  it('counts only future matching fairs within sixty Buenos Aires days as later dates', () => {
    const later = listing('Feria cultural', '2026-12-04T03:00:00.000Z')
    const distant = listing('Feria cultural distante', '2027-02-27T20:00:00.000Z')
    const selection = selectAgendaPage({ ...base, events: [nextWeek, later, distant] }, agendaPages['/agenda/ferias'])
    expect(selection.current).toEqual([])
    expect(ids(selection.later)).toEqual([later.id])
    expect(selection.next).toBe(later)
  })
})
