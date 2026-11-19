import { beforeAll, describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import * as m from '#paraglide/messages.js'
import { agendaEvent } from '../../../../tests/support/home-agenda.ts'
import { homeWindow, parseHomeFilter, selectHomeView, type HomeAgendaEvent } from './home-feed.ts'

const asOf = Date.parse('2026-11-19T14:00:00Z')
const window = homeWindow(new Date(asOf))
const events = Array.from({ length: 4 }, (_, index) => agendaEvent(
  `00000000-0000-4000-8000-00000000000${index}`, index < 3 ? '2026-11-19T18:00:00.000Z' : '2026-11-20T18:00:00.000Z', {
    name: index === 0 ? 'Jam sintética' : `Evento sintético ${index}`,
    image_url: `https://imagenes.passline.com/eventos/${index}.jpg`,
    price: 5000, is_free: index === 1, payWhatYouCan: index === 1, sourceUrl: index === 0 ? 'https://www.instagram.com/p/synthetic/' : null,
  },
))

// Bun's native runner has no Svelte compiler; Vitest's server project compiles these fixtures.
describe.skipIf('Bun' in globalThis)('homepage server-rendered agenda', () => {
  let HomeAgenda: typeof import('../components/HomeAgenda.svelte').default

  beforeAll(async () => {
    ({ default: HomeAgenda } = await import('../components/HomeAgenda.svelte'))
  }, 60_000)

  function renderAgenda(href: string, occurrences: HomeAgendaEvent[] | null = events) {
    const url = new URL(href, 'https://example.test')
    const filter = parseHomeFilter(url.searchParams.get('f'))
    const view = occurrences ? selectHomeView({ window, events: occurrences, asOf }, filter) : { events: [], empty: 'feed' as const }
    return render(HomeAgenda, { props: { view, filter, url, onAsk() {}, onFilter() {} } }).body
  }

  it('puts responsive artwork, titles, and event links in HTML before hydration', () => {
    const body = renderAgenda('/')
    expect(body.match(/<source /g)).toHaveLength(4)
    expect(body).toContain('calc((100vw - 44px) / 2)')
    expect(body).toContain('/api/event-artwork/')
    expect(body).toContain(`href="/events/${events[0].id}"`)
    expect(body).toContain('href="https://www.instagram.com/p/synthetic/"')
    expect(body).toContain('alt="Jam sintética"')
    expect(body).toContain('Sala sintética · Almagro · $5.000 ARS')
    expect(body.match(/loading="eager"/g)).toHaveLength(2)
    expect(body.match(/loading="lazy"/g)).toHaveLength(2)
    expect(body.match(/fetchpriority="high"/g)).toHaveLength(1)
  })

  it('renders contained 4:5 flyers and puts glossary triggers inside the original text', () => {
    const body = renderAgenda('/')
    expect(body.match(/aspect-ratio:\s*4 \/ 5/g)).toHaveLength(4)
    const cards = [...body.matchAll(/<article\b.*?<\/article>/gs)].map(([card]) => card)
    const title = cards[0]?.match(/<h2\b.*?<\/h2>/s)?.[0]
    const meta = cards[1]?.match(/<p\b.*?<\/p>/s)?.[0]
    expect(title).toMatch(/<button\b[^>]*aria-controls="gloss-[^"]+"[^>]*>Jam<\/button>.* sintética/s)
    expect(meta).toMatch(/Sala sintética · Almagro · .*<button\b[^>]*>A la gorra<\/button>/s)
    expect(cards[0]?.match(/<a\b.*?<\/a>/s)?.[0]).not.toContain('<button')
    expect(body.match(/aria-controls="gloss-/g)).toHaveLength(2)
  })

  it('renders the remaining times and links to the next upcoming slot', () => {
    const fields = { name: 'Visita guiada', venue_id: 'sala' }
    const occurrences = [
      agendaEvent('ended', '2026-11-19T10:00:00.000Z', fields),
      agendaEvent('running', '2026-11-19T13:00:00.000Z', fields),
      agendaEvent('upcoming', '2026-11-19T15:00:00.000Z', fields),
    ]
    const body = renderAgenda('/?f=hoy', occurrences)
    expect(body.match(/<article\b/g)).toHaveLength(1)
    expect(body).toContain('href="/events/upcoming"')
    expect(body).toMatch(/<time[^>]+13:00:00.000Z[^>]*>[^<]+<\/time>.* · .*<time[^>]+15:00:00.000Z/s)
    expect(body).not.toContain('10:00:00.000Z')
  })

  it('server-renders selected and empty filter URLs, and links to other views', () => {
    const today = renderAgenda('/?f=hoy')
    expect(today).toContain('href="/?f=finde"')
    expect(today).toContain('Evento sintético 2')
    expect(today).not.toContain('Evento sintético 3')
    const free = renderAgenda('/?f=gratis')
    expect(free).toContain(m.home_empty_free())
    expect(free).not.toContain('<article')
    const failed = renderAgenda('/', null)
    expect(failed).toContain(m.home_empty_feed())
    expect(failed).not.toContain('<article')
  })
})
