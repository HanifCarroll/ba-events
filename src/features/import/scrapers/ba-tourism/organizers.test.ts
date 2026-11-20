import { expect, it, vi } from 'vitest'
import { baTourismEnrichmentAdapter } from '../../adapters/enrichment/ba-tourism-enrichment.ts'
import { parseBATourismEvents } from './scraper.ts'
import { transformBATourismEvent } from './transformer.ts'

it('copies only named organizers from the current tourism agenda schema', () => {
  // Mirrored from the dynamic agenda widget shape; all listings are synthetic.
  const credited = { '@type': 'Event', name: 'Muestra sintética', organizer: {
    '@type': 'GovernmentOrganization', name: 'Colectivo Nube', url: 'https://example.com/event-button',
  } }
  const unspecified = { ...credited, name: 'Visita sin crédito', organizer: {
    '@type': 'GovernmentOrganization', name: 'Ente de Turismo del Gobierno de la Ciudad de Buenos Aires',
    url: 'https://turismo.buenosaires.gob.ar',
  } }
  const card = (name: string) => `<div class="card-landing"><h2>${name}</h2><h4 class="media-heading">Música | Gratis</h4>
    <p>¿Cuándo?</p><p>Viernes 20, 20 h.</p><p>¿Dónde?</p><p>Sala Sintética, Retiro</p></div>`
  const html = card(credited.name) + card(unspecified.name) +
    `<script type="application/ld+json" class="schema-masivo-ia">${JSON.stringify([credited, unspecified])}</script>`
  const events = parseBATourismEvents(html)
  const startDate = new Date('2026-11-16T12:00:00-03:00')
  const endDate = new Date('2026-11-22T12:00:00-03:00')
  const [withCredit, withoutCredit] = events.flatMap(event => transformBATourismEvent(event, { startDate, endDate }, null, startDate))
  expect(withCredit).toMatchObject({ organizer_name: 'Colectivo Nube' })
  expect(withCredit).not.toHaveProperty('organizer_url')
  expect(withoutCredit).not.toHaveProperty('organizer_name')
})

it('checks the linked detail once for an explicit organizer when the card lacks one', async () => {
  const detail = `Title: Muestra sintética\n\nMarkdown Content:\n# Muestra sintética\n\nDónde: Sala Nube\n\n**Organiza:** [Asociación Puente](https://puente.example/)`
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(detail))
    .mockResolvedValueOnce(new Response('# Muestra sintética\nDónde: Sala Nube'))
  try {
    const url = 'https://turismo.buenosaires.gob.ar/es/article/sintetico'
    const read = baTourismEnrichmentAdapter.serverEnrich!
    expect(await read(url, { organizerOnly: true })).toMatchObject({ organizer: { name: 'Asociación Puente', url: 'https://puente.example/' } })
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(url)
    expect(await read(url, { organizerOnly: true })).toBeNull()
  } finally { fetchSpy.mockRestore() }
})
