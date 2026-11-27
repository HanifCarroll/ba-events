import { readFileSync } from 'node:fs'
import { trace } from '@opentelemetry/api'
import type { RequestEvent } from '@sveltejs/kit'
import { render } from 'svelte/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { useCloudflareBindings } from '#shared/lib/db/search-bindings.server.ts'
import { handleLocaleSync, handleParaglide } from '../../hooks.server.ts'
import { freshD1 } from '../../../tests/support/d1.ts'
import { loadAgendaPage } from './api/agenda-page.server.ts'
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

  it('puts a single ongoing free event under Today and counts it once', async () => {
    const html = await requestAgenda('/agenda/gratis', 'cookie')
    expect(html).toContain('Hoy hay 1.')
    expect(html.match(/<article\b[^>]*data-section="event-card"/g)).toHaveLength(1)
    expect(html).toMatch(/<h2 data-section="day"[^>]*>Hoy<\/h2>\s*<article.*?href="\/events\/ongoing-exhibition"/s)
    expect(html).not.toMatch(/<h2 data-section="day"[^>]*>jueves/i)
  })
})
