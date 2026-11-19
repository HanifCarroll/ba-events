import { beforeAll, describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import * as m from '#paraglide/messages.js'
import { agendaEvent } from '../../../../tests/support/home-agenda.ts'
import { homeWindow } from './home-feed.ts'

const window = homeWindow(new Date('2026-11-19T14:00:00Z'))
const events = Array.from({ length: 4 }, (_, index) => agendaEvent(
  `00000000-0000-4000-8000-00000000000${index}`, index < 3 ? '2026-11-19T18:00:00.000Z' : '2026-11-20T18:00:00.000Z', {
    name: index === 0 ? 'Jam sintética' : `Evento sintético ${index}`,
    image_url: `https://imagenes.passline.com/eventos/${index}.jpg`,
    price: 5000, payWhatYouCan: index === 1, sourceUrl: index === 0 ? 'https://www.instagram.com/p/synthetic/' : null,
  },
))

// Bun's native runner has no Svelte compiler; Vitest's server project compiles these fixtures.
describe.skipIf('Bun' in globalThis)('homepage server-rendered agenda', () => {
  let HomeAgenda: typeof import('../components/HomeAgenda.svelte').default

  beforeAll(async () => {
    ({ default: HomeAgenda } = await import('../components/HomeAgenda.svelte'))
  }, 60_000)

  it('puts responsive artwork, titles, and event links in HTML before hydration', () => {
    const { body } = render(HomeAgenda, { props: { agenda: { window, events }, url: new URL('https://example.test/'), onAsk() {}, onFilter() {} } })
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
    const { body } = render(HomeAgenda, { props: { agenda: { window, events }, url: new URL('https://example.test/'), onAsk() {}, onFilter() {} } })
    expect(body.match(/aspect-ratio:\s*4 \/ 5/g)).toHaveLength(4)
    const cards = [...body.matchAll(/<article\b.*?<\/article>/gs)].map(([card]) => card)
    const title = cards[0]?.match(/<h2\b.*?<\/h2>/s)?.[0]
    const meta = cards[1]?.match(/<p\b.*?<\/p>/s)?.[0]
    expect(title).toMatch(/<button\b[^>]*aria-controls="gloss-[^"]+"[^>]*>Jam<\/button>.* sintética/s)
    expect(meta).toMatch(/Sala sintética · Almagro · .*<button\b[^>]*>A la gorra<\/button>/s)
    expect(cards[0]?.match(/<a\b.*?<\/a>/s)?.[0]).not.toContain('<button')
    expect(body.match(/aria-controls="gloss-/g)).toHaveLength(2)
  })

  it('server-renders selected and empty filter URLs, and links to other views', () => {
    const props = { agenda: { window, events }, onAsk() {}, onFilter() {} }
    const today = render(HomeAgenda, { props: { ...props, url: new URL('https://example.test/?f=hoy') } }).body
    expect(today).toContain('href="/?f=finde"')
    expect(today).toContain('Evento sintético 2')
    expect(today).not.toContain('Evento sintético 3')
    const free = render(HomeAgenda, { props: { ...props, url: new URL('https://example.test/?f=gratis') } }).body
    expect(free).toContain(m.home_empty_free())
    expect(free).not.toContain('<article')
    const failed = render(HomeAgenda, { props: { ...props, agenda: null, url: new URL('https://example.test/') } }).body
    expect(failed).toContain(m.home_empty_feed())
    expect(failed).not.toContain('<article')
  })
})
