import { beforeAll, describe, expect, it } from 'vitest'
import { createRawSnippet } from 'svelte'
import { render } from 'svelte/server'
import * as m from '#paraglide/messages.js'
import { paraglideMiddleware } from '#paraglide/server.js'
import { agendaEvent } from '../../../../tests/support/home-agenda.ts'
import { homeWindow, pageHomeView, parseHomeFilter, selectHomeView, type HomeAgendaEvent } from './home-feed.ts'

const asOf = Date.parse('2026-11-19T14:00:00Z')
const window = homeWindow(new Date(asOf))
const events = Array.from({ length: 4 }, (_, index) => agendaEvent(
  `00000000-0000-4000-8000-00000000000${index}`, index < 3 ? '2026-11-19T18:00:00.000Z' : '2026-11-20T18:00:00.000Z', {
    name: index === 0 ? 'Jam sintética' : `Evento sintético ${index}`,
    image_url: `https://imagenes.passline.com/eventos/${index}.jpg`,
    price: 5000, is_free: index === 1, payWhatYouCan: index === 1, sourceUrl: index === 0 ? 'https://www.instagram.com/p/synthetic/' : null,
  },
))

describe('homepage server-rendered agenda', () => {
  let HomeAgenda: typeof import('../components/HomeAgenda.svelte').default

  beforeAll(async () => {
    ({ default: HomeAgenda } = await import('../components/HomeAgenda.svelte'))
  }, 60_000)

  function renderAgenda(href: string, occurrences: HomeAgendaEvent[] | null = events) {
    const url = new URL(href, 'https://example.test')
    const filter = parseHomeFilter(url.searchParams.get('f'))
    const fullView = occurrences ? selectHomeView({ window, events: occurrences, asOf }, filter) : { events: [], empty: 'feed' as const }
    const view = pageHomeView(fullView, url.searchParams.get('n'))
    const composer = createRawSnippet(() => ({ render: () => '<section data-test-chat></section>' }))
    return render(HomeAgenda, { props: { view, filter, url, composer, day: window.day, onAsk() {}, async onMore() {} } }).body.replace(/<!--.*?-->/gs, '')
  }

  it('renders a browsable agenda without mounting a chat component', () => {
    const url = new URL('https://example.test/')
    const view = pageHomeView(selectHomeView({ window, events, asOf }, null), null)
    const { body } = render(HomeAgenda, { props: { view, filter: null, url, day: window.day, async onMore() {} } })
    expect(body).toContain(`href="/events/${events[0].id}"`)
    expect(body).toContain(m.home_showing_count({ shown: events.length, total: events.length }))
    expect(body).not.toContain('data-section="agenda-composer"')
    expect(body).not.toContain(m.home_ask_event({ name: events[0].name }))
  })

  it('puts responsive artwork, titles, and event links in HTML before hydration', () => {
    const body = renderAgenda('/')
    expect(body.match(/<source /g)).toHaveLength(8)
    expect(body).toContain('(width &lt; 768px) 96px')
    expect(body).toContain('blur-xl brightness-50')
    expect(body).toContain('/api/event-artwork/')
    expect(body).toContain(`href="/events/${events[0].id}"`)
    expect(body).toContain('href="https://www.instagram.com/p/synthetic/"')
    expect(body).toContain('alt="Jam sintética"')
    expect(body).toMatch(/Sala sintética · Almagro.*\$5\.000 ARS/s)
    expect(body.match(/<img\b[^>]*alt="[^"]+"[^>]*loading="eager"/g)).toHaveLength(4)
    expect(body.match(/fetchpriority="high"/g)).toHaveLength(1)
    const firstImage = body.match(/<img\b[^>]*>/)?.[0]
    expect(firstImage).toContain('alt="Jam sintética"')
    expect(firstImage).toContain('fetchpriority="high"')
  })

  it.each([
    ['es', 'Ver post', 'Ver post de Jam sintética', 'Ver evento', 'Ver evento: Evento sintético 1', 'Preguntar', 'Preguntar sobre Jam sintética'],
    ['en', 'View post', 'View post for Jam sintética', 'View event', 'View event: Evento sintético 1', 'Ask', 'Ask about Jam sintética'],
  ])('renders visible, event-specific source and ask actions in %s', async (locale, post, postName, external, externalName, ask, askName) => {
    const request = new Request('https://example.test/', { headers: { cookie: `PARAGLIDE_LOCALE=${locale}` } })
    await paraglideMiddleware(request, () => {
      const sourceUrl = 'https://lu.ma/synthetic'
      const body = renderAgenda('/', [events[0], { ...events[1], sourceUrl }])
      expect(body).toContain(`aria-label="${postName}"`)
      expect(body).toContain(`aria-label="${externalName}"`)
      expect(body).toContain(`aria-label="${askName}"`)
      expect(body).toContain(`href="${sourceUrl}"`)
      for (const label of [post, external, ask]) expect(body).toContain(`<span>${label}</span>`)
      return new Response()
    })
  })

  it('renders a plain paging link, resets paging in filter links, and keeps later flyers lazy', () => {
    const free = Array.from({ length: 50 }, (_, i) => agendaEvent(`free-${i}`, events[0].starts_at, { is_free: true }))
    const first = renderAgenda('/?f=gratis', free)
    expect(first).toContain(m.home_showing_count({ shown: 24, total: 50 }))
    expect(first).toMatch(/<a href="\/\?f=gratis&amp;n=48"[^>]*>Ver más<\/a>/)
    expect(first.match(/<img\b[^>]*alt="[^"]+"[^>]*loading="eager"/g)).toHaveLength(4)
    expect(first.match(/<img\b[^>]*alt="[^"]+"[^>]*loading="lazy"/g)).toHaveLength(20)
    const more = renderAgenda('/?f=gratis&n=48', free)
    expect(more).toContain(m.home_showing_count({ shown: 48, total: 50 }))
    expect(more).toContain('href="/?f=hoy"')
    expect(more).toContain('href="/?f=gratis&amp;n=72"')
  })

  it('renders contained 4:5 flyers and puts glossary triggers inside the original text', () => {
    const body = renderAgenda('/')
    expect(body.match(/aspect-ratio:\s*4 \/ 5/g)).toHaveLength(4)
    const cards = [...body.matchAll(/<article\b.*?<\/article>/gs)].map(([card]) => card)
    const title = cards[0]?.match(/<h2\b.*?<\/h2>/s)?.[0]
    const meta = cards[1]?.match(/<p\b.*?<\/p>/s)?.[0]
    expect(title).toMatch(/<button\b[^>]*aria-controls="gloss-[^"]+"[^>]*>Jam<\/button>.* sintética/s)
    expect(meta).toMatch(/Sala sintética · Almagro.*<button\b[^>]*>A la gorra<\/button>/s)
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

  it('does not start a new day at UTC midnight, the composer, or the page boundary', () => {
    const sample = Array.from({ length: 27 }, (_, i) => agendaEvent(`day-${i}`,
      i < 6 ? '2026-11-19T23:59:00.000Z' : i < 26 ? '2026-11-20T02:59:00.000Z' : '2026-11-20T03:00:00.000Z'))
    const first = renderAgenda('/', sample)
    const more = renderAgenda('/?n=48', sample)
    const headings = (html: string) => [...html.matchAll(/<h2 data-section="day"[^>]*>([^<]+)<\/h2>/g)].map(([, heading]) => heading)
    expect(first.match(/<article\b/g)).toHaveLength(24)
    expect(headings(first)).toEqual([m.landing_today()])
    const tomorrow = m.home_tomorrow()
    expect(headings(more)).toEqual([m.landing_today(), tomorrow])
    expect(more.indexOf(tomorrow)).toBeGreaterThan(more.indexOf('href="/events/day-25"'))
    expect(more.indexOf(tomorrow)).toBeLessThan(more.indexOf('href="/events/day-26"'))
  })

  it('keeps the date grid-only and shows local time or Time TBA in phone rows', () => {
    const starts = '2026-11-19T23:30:00.000Z'
    const body = renderAgenda('/', [agendaEvent('timed', starts), agendaEvent('tba', starts, { time_tba: true })])
    expect(body).toMatch(/<span class="hidden md:inline"><time[^>]*>[^<]+<\/time> · <\/span>\s*<time[^>]*>20:30<\/time>/)
    expect(body).toContain(m.concierge_time_tba())
  })

  it.each([
    { href: '/', count: 4, before: 4, after: 0 },
    { href: '/', count: 6, before: 6, after: 0 },
    { href: '/', count: 10, before: 6, after: 4 },
    { href: '/?f=gratis', count: 10, before: 3, after: 0 },
    { href: '/?f=musica', count: 10, before: 6, after: 2 },
    { href: '/?f=hoy', count: 0, before: 0, after: 0 },
  ])('renders one composer in $href with $count source events and $before before it in source order', ({ href, count, before, after }) => {
    const sample = Array.from({ length: count }, (_, i) => agendaEvent(`sample-${i}`,
      events[0].starts_at, { is_free: i < 3, music: i >= 2 }))
    const html = renderAgenda(href, sample)
    const [leading, trailing, extra] = html.split('data-test-chat')
    expect(extra).toBeUndefined()
    expect(leading.match(/<article\b/g) ?? []).toHaveLength(before)
    expect(trailing.match(/<article\b/g) ?? []).toHaveLength(after)
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
