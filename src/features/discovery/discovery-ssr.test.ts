import { readFileSync } from 'node:fs'
import { trace } from '@opentelemetry/api'
import type { RequestEvent } from '@sveltejs/kit'
import { load } from 'cheerio'
import { render } from 'svelte/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { useCloudflareBindings } from '#shared/lib/db/search-bindings.server.ts'
import { handleLocaleSync, handleParaglide } from '../../hooks.server.ts'
import { freshD1 } from '../../../tests/support/d1.ts'
import { loadAboutPage } from './api/about-page.server.ts'
import { loadAgendaPage } from './api/agenda-page.server.ts'
import { loadBarrioPage, loadVenuePage } from './api/place-page.server.ts'
import AboutPage from './components/AboutPage.svelte'
import AgendaPage from './components/AgendaPage.svelte'

vi.mock('$app/state', () => ({ page: { url: new URL('https://baeventos.com/agenda/gratis') } }))

const appHtml = readFileSync(new URL('../../app.html', import.meta.url), 'utf8')
const asOf = new Date('2026-11-27T15:00:00.000Z')
let fixture: Awaited<ReturnType<typeof freshD1>>

beforeAll(async () => {
  fixture = await freshD1()
  useCloudflareBindings({ DB: fixture.db })
  await fixture.db.batch([
    fixture.db.prepare(`INSERT INTO venues (id, name, neighborhood) VALUES ('fixture-sala', 'Sala de Ejemplo', 'Almagro')`),
    fixture.db.prepare(`INSERT INTO events
      (id, name, source, starts_at, ends_at, status, scope, image_url, venue_id, is_free, facets)
      VALUES ('ongoing-exhibition', 'Muestra de ejemplo', 'luma', '2026-11-26T18:00:00.000Z', '2026-11-28T22:00:00.000Z',
        'scheduled', 'in', 'https://example.test/exhibition.png', 'fixture-sala', 1, '{"eventType":["exhibition"]}')`),
  ])
}, 60_000)

afterAll(async () => {
  useCloudflareBindings({})
  await fixture?.dispose()
})

type Locale = 'es' | 'en'
type PreferenceSource = 'cookie' | 'accept-language'
type RenderPage = () => Promise<{ head: string; body: string }>

async function requestPage(path: string, source: PreferenceSource, preference: Locale, renderPage: RenderPage) {
  const url = new URL(path, 'https://baeventos.com')
  const headers = new Headers({ accept: 'text/html' })
  if (source === 'cookie') headers.set('cookie', `PARAGLIDE_LOCALE=${preference}`)
  else headers.set('accept-language', preference)
  const set = vi.fn()
  const span = trace.getTracer('discovery-test').startSpan('ssr')
  const event: RequestEvent = {
    url, request: new Request(url, { headers }), route: { id: null },
    cookies: { get: name => name === 'PARAGLIDE_LOCALE' && source === 'cookie' ? preference : undefined,
      getAll: () => [], set, delete: vi.fn(), parse: vi.fn(), serialize: vi.fn() },
    locals: { user: null, isAdmin: false, profile: null },
    fetch, getClientAddress: () => '127.0.0.1', params: {}, platform: undefined, setHeaders: vi.fn(),
    isDataRequest: false, isSubRequest: false, isRemoteRequest: false,
    tracing: { enabled: false, root: span, current: span },
  }
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(asOf)
  try {
    const response = await handleLocaleSync({ event, resolve: async synced => handleParaglide({
      event: synced,
      resolve: async (_event, options) => {
        const { head, body } = await renderPage()
        const html = appHtml.replace('%sveltekit.head%', () => head).replace('%sveltekit.body%', () => body)
        return new Response(await options?.transformPageChunk?.({ html, done: true }) ?? html)
      },
    }) })
    expect(response.status).toBe(200)
    expect(set).not.toHaveBeenCalled()
    expect(response.headers.get('set-cookie')).toBeNull()
    return (await response.text()).replace(/<!--.*?-->/gs, '')
  } finally {
    vi.useRealTimers()
    span.end()
  }
}

function requestAgenda(path: string, source: PreferenceSource, preference: Locale = 'en') {
  return requestPage(path, source, preference, async () => {
    const data = await loadAgendaPage(path, () => {}, false)
    return render(AgendaPage, { props: { data } })
  })
}

const preferenceSources = ['cookie', 'accept-language'] as const

describe('initial discovery HTML', () => {
  it.each(preferenceSources)('renders a Spanish agenda and Spanish card labels even with English %s', async source => {
    const html = await requestAgenda('/agenda/gratis', source)
    expect(html).toContain('<html lang="es"')
    expect(html).toMatch(/<article\b[^>]*>.*?>Gratis<.*?<\/article>/s)
  })

  it.each(preferenceSources)('renders a Spanish topic agenda and card with English %s', async source => {
    const html = await requestAgenda('/agenda/muestras', source)
    expect(html).toContain('<html lang="es"')
    expect(html).toMatch(/<article\b[^>]*>.*?>Gratis<.*?<\/article>/s)
  })

  it.each(preferenceSources)('renders barrio and venue cards in Spanish with English %s', async source => {
    for (const [path, load] of [
      ['/agenda/barrio/almagro', () => loadBarrioPage('almagro', () => {}, false)],
      ['/lugares/sala-de-ejemplo', () => loadVenuePage('sala-de-ejemplo', () => {}, false)],
    ] as const) {
      const html = await requestPage(path, source, 'en', async () => render(AgendaPage, { props: { data: await load() } }))
      expect(html).toContain('<html lang="es"')
      expect(html).toMatch(/<article\b[^>]*>.*?>Gratis<.*?<\/article>/s)
    }
  })

  it.each(preferenceSources)('renders English agendas, cards, and nav with Spanish %s', async source => {
    for (const [path, label, alternate, alternateLabel] of [
      ['/en/things-to-do-this-weekend', 'This weekend', '/en/free-events-this-week', 'Free'],
      ['/en/free-events-this-week', 'Free', '/en/things-to-do-this-weekend', 'This weekend'],
    ] as const) {
      const html = await requestAgenda(path, source, 'es')
      expect(html).toContain('<html lang="en"')
      expect(html).toMatch(/<article\b[^>]*>.*?>Free<.*?<\/article>/s)
      const $ = load(html)
      const nav = $('nav[aria-label="Agenda dates"]')
      expect(nav.find('[aria-current="page"]').text()).toBe(label)
      expect(nav.find('a[aria-current], a[href="' + path + '"]').length).toBe(0)
      expect(nav.find('a[href="' + alternate + '"]').text()).toBe(alternateLabel)
      expect(nav.find('a[href="/agenda/hoy"]').text()).toBe('Today')
      expect(nav.find('a[href="/agenda/esta-semana"]').text()).toBe('This week')
    }
  })

  it.each(preferenceSources)('keeps the about routes in their own document language with the opposite %s', async source => {
    for (const [path, preference, expected] of [['/en/about', 'es', 'en'], ['/que-es-ba-eventos', 'en', 'es']] as const) {
      const html = await requestPage(path, source, preference, async () => {
        const data = await loadAboutPage(path, () => {}, false)
        return render(AboutPage, { props: { data } })
      })
      expect(html).toContain(`<html lang="${expected}"`)
    }
  })

  it('groups the same ongoing free card and count under Today in English', async () => {
    const $ = load(await requestAgenda('/en/free-events-this-week', 'cookie', 'es'))
    expect($('[data-section="discovery-page"] > p').text()).toContain('1 is today.')
    const cards = $('[data-section="event-card"]')
    expect(cards.length).toBe(1)
    expect(cards.first().prev('[data-section="day"]').text()).toBe('Today')
  })

  it('puts a single ongoing free event under Today and counts it once', async () => {
    const html = await requestAgenda('/agenda/gratis', 'cookie')
    expect(html).toContain('Hoy hay 1.')
    expect(html.match(/<article\b[^>]*data-section="event-card"/g)).toHaveLength(1)
    expect(html).toMatch(/<h2 data-section="day"[^>]*>Hoy<\/h2>\s*<article.*?href="\/events\/ongoing-exhibition"/s)
    expect(html).not.toMatch(/<h2 data-section="day"[^>]*>jueves/i)
  })
})
