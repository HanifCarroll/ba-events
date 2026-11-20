import { afterEach, describe, expect, it, vi } from 'vitest'
import { Effect } from 'effect'
import { readFileSync } from 'node:fs'
import { normalizePageText, officialSites, publicPageUrl, readOfficialPage, renderedPageRead, siteOf, verifyOfficialPagesEffect, visibleText } from './official-page.ts'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), 'utf8')

const page = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, ...init })
const readHtml = (html: string) => (url: string, sites: ReadonlySet<string>) =>
  readOfficialPage(url, sites, (async () => page(html)) as typeof fetch)
const sites = officialSites({ website: 'https://www.teatro.example.org', captions: ['Entradas: https://down.example.org/obra'] })
const facts = { name: 'Forever Sintético', date: '2026-11-23', time: '21:00', sites }
const SHOWTIMES = `<html><head><title>Sala Sintética</title><script>var s = "LUNES 1 ENERO 09:00"</script></head><body><h1>Forever&nbsp;Sint&eacute;tico</h1>
  <div class="sp-funcion-fecha">
      LUNES 23 NOVIEMBRE
  </div>
  <div class="sp-funcion-hora">21:00</div>
  <p hidden>MARTES 23 NOVIEMBRE 21:00</p><p style="display: none">MIÉRCOLES 25 NOVIEMBRE</p>
  <p>Teatro&nbsp;Sint&eacute;tico, Pasaje Ficticio 1234</p>
</body></html>`
const evidence = (url: string, excerpt: string, fields: Array<'date' | 'time' | 'venue'> = ['date', 'time']) => ({ kind: 'official_page' as const, url, fields, excerpt })

describe('official-page evidence', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('accepts only public HTTPS host names', () => {
    expect(publicPageUrl('https://www.teatro-sintetico.com.ar/obra/x/')).toBe(true)
    for (const url of ['http://teatro.example.org/', 'https://127.0.0.1/', 'https://10.0.0.8/', 'https://[::1]/', 'https://printer.local/',
      'https://localhost/', 'https://user:pw@example.org/', 'https://example.org:8443/', 'https://intranet/', 'not a url']) {
      expect(publicPageUrl(url), url).toBe(false)
    }
  })

  it('reads visible text only: no scripts, head, or hidden elements', () => {
    const text = visibleText(SHOWTIMES)
    expect(text).toContain('LUNES 23 NOVIEMBRE')
    expect(text).toContain('Teatro\u00a0Sintético')
    expect(text).not.toContain('ENERO')
    expect(text).not.toContain('MARTES')
    expect(text).not.toContain('MIÉRCOLES')
    expect(text).not.toContain('Sala Sintética')
  })

  it('matches the Picadero shape across separate date and time elements, case, and accents', async () => {
    const reasons = await Effect.runPromise(verifyOfficialPagesEffect([
      evidence('https://teatro.example.org/obra', 'Lunes 23 noviembre 21:00'),
      evidence('https://teatro.example.org/obra', 'teatro sintetico, pasaje ficticio 1234', ['venue']),
    ], facts, readHtml(SHOWTIMES)))
    expect(reasons).toEqual([])
    expect(normalizePageText(' Á  b\u00a0C ')).toBe('a b c')
    expect(normalizePageText(visibleText('<p><span>LUNES</span><span>23</span></p>'))).toBe('lunes 23')
  })

  it('keeps token boundaries: "sábado 2 21:00" is not "sábado 22 1:00" or "12 21:00"', async () => {
    const page = readHtml('<h1>Forever Sintético</h1><p>sábado 22 1:00</p><p>viernes 12 21:00</p>')
    const day2 = { ...facts, date: '2026-11-02' }
    for (const excerpt of ['sábado 2 21:00', 'el 2 21:00 y más']) {
      expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence('https://teatro.example.org/obra', excerpt)], day2, page)))
        .toEqual(["Official page evidence must be an excerpt of the page's visible text: https://teatro.example.org/obra"])
    }
  })

  it('requires the show\'s name on the page and the cited date and time in the excerpt', async () => {
    const run = (excerpt: string, fields?: Array<'date' | 'time'>, html = SHOWTIMES, at = facts) =>
      Effect.runPromise(verifyOfficialPagesEffect([evidence('https://teatro.example.org/obra', excerpt, fields)], at, readHtml(html)))
    expect(await run('LUNES 23 NOVIEMBRE 21:00', undefined, SHOWTIMES.replace(/Forever&nbsp;Sint&eacute;tico/, 'Otra obra')))
      .toEqual(['Official page does not name "Forever Sintético" (page title: "Sala Sintética"; H1: "Otra obra"): https://teatro.example.org/obra'])
    expect(await run('NOVIEMBRE 2026 en cartel', ['date'], '<h1>Forever Sintético</h1><p>NOVIEMBRE 2026 en cartel</p>'))
      .toEqual(['Official page excerpt does not state the day 23: https://teatro.example.org/obra'])
    expect(await run('LUNES 23 NOVIEMBRE 21:00', undefined, SHOWTIMES, { ...facts, time: '21:30' }))
      .toEqual(['Official page excerpt does not state the time 21:30: https://teatro.example.org/obra'])
    // Leading zeros and 12-hour times with p.m. count.
    expect(await run('lunes 02/11 9 p.m.', undefined, '<h1>Forever Sintético</h1><p>Lunes 02/11 9 p.m.</p>', { ...facts, date: '2026-11-02' })).toEqual([])
  })

  it.each([
    ['viernes 20.11 21:00 hs', '2026-11-21', '20:00', 'day 21'],
    ['viernes 20.11 21:00 hs', '2026-11-20', '20:00', 'time 20:00'],
    ['viernes 20.11 21:00 hs', '2026-12-20', '21:00', 'month 12'],
    ['20/11/2025, 18:30 hs', '2026-11-20', '18:30', 'year 2026'],
    ['Empieza el sáb 28 de nov 2025 22:00', '2026-11-28', '22:00', 'year 2026'],
    ['Viernes 20 de noviembre del 2025 a las 21:00', '2026-11-20', '21:00', 'year 2026'],
    ['diciembre: viernes 20 a las 21:00', '2026-11-20', '21:00', 'month 11'],
    ['viernes 20/11, 2025 - 21:00', '2026-11-20', '21:00', 'year 2026'],
    ['20/11/2026 entradas', '2026-11-20', '20:00', 'time 20:00'],
    ['21:23 hs', '2026-11-23', '21:23', 'day 23'],
    ['Viernes, 20 de Noviembre 21:00 - 23:30 hs', '2026-11-20', '23:30', 'time 23:30'],
    ['viernes 20 de noviembre de 21:00 a las 23:30 hs', '2026-11-20', '23:30', 'time 23:30'],
    ['viernes 20 de noviembre de 21 a 23 hs', '2026-11-20', '23:00', 'time 23:00'],
    ['20/11/2026 de 21 a 23 hs', '2026-11-20', '23:00', 'time 23:00'],
    ['20/11/2026 de 21 a 23:30 hs', '2026-11-20', '23:30', 'time 23:30'],
    ['20/11/2026 de 8 a 10 p.m.', '2026-11-20', '22:00', 'time 22:00'],
    ['2 funciones: 21:00', '2026-11-02', '21:00', 'day 2'],
    ['24 MAR 21:00 hs', '2026-11-24', '21:00', 'month 11'],
  ])('does not use %s as evidence for %s at %s', async (excerpt, date, time, missing) => {
    expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(officialUrl, excerpt)], { ...facts, date, time },
      readHtml(`<h1>${facts.name}</h1><p>${excerpt}</p>`))))
      .toEqual([`Official page excerpt does not state the ${missing}: ${officialUrl}`])
  })

  it.each([
    ['Empieza el sáb 28 de nov 2026 22:00', '2026-11-28', '22:00'],
    ['20/11/2026, 18:30 hs', '2026-11-20', '18:30'],
    ['viernes 20/11/2026 - 21:00 hs', '2026-11-20', '21:00'],
    ['VIE 15 ENE 20:30 hs', '2027-01-15', '20:30'],
    ['MAR 24 NOV 21:00 hs', '2026-11-24', '21:00'],
    ['24 MAR 21:00 hs', '2027-03-24', '21:00'],
    ['viernes 20 de noviembre a las 20.30 hs', '2026-11-20', '20:30'],
    ['viernes 20 de noviembre a las 21', '2026-11-20', '21:00'],
    ['Noviembre: viernes 20 a las 21', '2026-11-20', '21:00'],
    ['viernes 20/11, 2026 - 21:00', '2026-11-20', '21:00'],
    ['Viernes, 20 de Noviembre\n21:00 - 23:30 hs', '2026-11-20', '21:00'],
    ['viernes 20 de noviembre de 21:00 a las 23:30 hs', '2026-11-20', '21:00'],
    ['viernes 20 de noviembre de 21 a 23 hs', '2026-11-20', '21:00'],
    ['20/11/2026 de 21 a 23 hs', '2026-11-20', '21:00'],
    ['20/11/2026 de 21 a 23:30 hs', '2026-11-20', '21:00'],
    ['20/11/2026 21:00-23:30 hs', '2026-11-20', '21:00'],
    ['20/11/2026 21 a 23 hs', '2026-11-20', '21:00'],
    ['viernes 20 a las 21 hs', '2026-11-20', '21:00'],
    ['día 20 a las 21:00', '2026-11-20', '21:00'],
    ['Noviembre 20 a las 21:00', '2026-11-20', '21:00'],
    ['viernes 20.11 21:00 hs', '2026-11-20', '21:00'],
    ['Lunes 02/11 12 a.m.', '2026-11-02', '00:00'],
  ])('accepts %s for %s at %s', async (excerpt, date, time) => {
    expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(officialUrl, excerpt)], { ...facts, date, time },
      readHtml(`<h1>${facts.name}</h1><p>${excerpt}</p>`)))).toEqual([])
  })

  it.each([
    ['Viernes 20 a las 21:00 y sábado 21 a las 18:00', '2026-11-20', '18:00'],
    ['2 funciones: 18:00 y 21:00', '2026-11-02', '21:00'],
    ['20/11/2026, 2 funciones: 18 y 21 hs', '2026-11-20', '21:00'],
    ['Viernes 20 a las 18 y 21', '2026-11-20', '18:00'],
    ['Viernes 20/11 y sábado 21 a las 18:00', '2026-11-21', '18:00'],
    ['20 y 21 de noviembre a las 18:00', '2026-11-21', '18:00'],
    ['Viernes 20 a las 18:00 y 21:00', '2026-11-20', '21:00'],
  ])('asks for a single occurrence when the quote is %s', async (excerpt, date, time) => {
    expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(officialUrl, excerpt)], { ...facts, date, time },
      readHtml(`<h1>${facts.name}</h1><p>${excerpt}</p>`))))
      .toEqual([`Official page excerpt lists multiple dates or start times; cite the single occurrence's line: ${officialUrl}`])
  })

  it.each([
    ['LUNES 23 NOVIEMBRE', 'date', 'time 21:00'],
    ['Funciones a las 21:00', 'time', 'day 23'],
  ] as const)('requires both date and start even when only one field is cited: %s', async (excerpt, field, missing) => {
    expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(officialUrl, excerpt, [field])], facts,
      readHtml(`<h1>${facts.name}</h1><p>${excerpt}</p>`))))
      .toEqual([`Official page excerpt does not state the ${missing}: ${officialUrl}`])
  })

  it('rejects a contradictory date even when an excerpt is cited only for time', async () => {
    const excerpt = '23 diciembre 21:00'
    expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(officialUrl, excerpt, ['time'])], facts,
      readHtml(`<h1>${facts.name}</h1><p>${excerpt}</p>`))))
      .toEqual([`Official page excerpt does not state the month 11: ${officialUrl}`])
  })

  const officialUrl = 'https://teatro.example.org/obra'
  const officialQuote = 'LUNES 23 NOVIEMBRE 21:00'
  const verifyShow = (name: string, html: string) => Effect.runPromise(verifyOfficialPagesEffect(
    [evidence(officialUrl, officialQuote)], { ...facts, name }, readHtml(html)))

  it('normalizes the Fiorel show name without treating a different spelling as equal', async () => {
    const name = 'Fiorel y Crezco del Viento + Joaquin y Orquesta de Bolsillo'
    const label = 'Fiorel y crezco del viento - Joaquín y orquesta de bolsillo'
    const schedule = `<p>${officialQuote}</p>`
    expect(await verifyShow(name, `<head><title>${label}</title></head><body>${schedule}</body>`)).toEqual([])
    expect(await verifyShow(name, `<h1>${label}</h1>${schedule}`)).toEqual([])
    const wrong = name.replace('Joaquin', 'Joaquinx')
    expect(await verifyShow(wrong, `<h1>${label}</h1>${schedule}`)).toEqual([
      `Official page does not name "${wrong}" (H1: "${label}"): ${officialUrl}`,
    ])
  })

  it('uses a document title without head tags for the name, but never for the excerpt', async () => {
    const show = 'Sol y Luna'
    expect(await verifyShow(show, `<title>${show}</title><p>${officialQuote}</p>`)).toEqual([])
    expect(await verifyShow(show, `<html><title>${show}</title><body><p>${officialQuote}</p></body></html>`)).toEqual([])
    expect(await verifyShow(show, `<title>${officialQuote}</title><h1>${show}</h1>`)).toEqual([
      `Official page evidence must be an excerpt of the page's visible text: ${officialUrl}`,
    ])
  })

  it('skips a site-name H1 only when the next visible H1 corroborates the split title or og:site_name matches', async () => {
    const header = `<header><h1>Bolsa Sintética</h1></header><p>${officialQuote}</p>`
    const title = '<title>Sol y Luna - Bolsa Sintética</title>'
    expect(await verifyShow('Sol + Luna', `${title}${header}`)).toEqual([
      `Official page does not name "Sol + Luna" (page title: "Sol y Luna - Bolsa Sintética"; H1: "Bolsa Sintética"): ${officialUrl}`,
    ])
    expect(await verifyShow('Sol + Luna', `${title}${header}<h1 hidden>Otra obra oculta</h1><h1>Sol y Luna</h1>`)).toEqual([])
    expect(await verifyShow('Sol + Luna', `<title>Bolsa Sintética | Sol y Luna</title>${header}<h1>Sol y Luna</h1>`)).toEqual([])
    expect((await verifyShow('Sol + Luna', `${title}${header}<h1>Agenda</h1>`))[0]).toContain('H1: "Bolsa Sintética"')
    const og = `<meta property="og:site_name" content="Bolsa Sintética">${title}${header}`
    expect(await verifyShow('Sol + Luna', og)).toEqual([])
    expect((await verifyShow('Sol + Luna', `${og}<h1>Agenda</h1><h2>Sol y Luna</h2>`))[0]).toContain('H1: "Agenda"')
    expect(await verifyShow('Sol + Luna', `<title>Bolsa Sintética - Sol y Luna</title><meta property="og:site_name" content="Bolsa Sintética"><h1>Sol y Luna</h1><h1>Agenda</h1><p>${officialQuote}</p>`)).toEqual([])
    const logo = '<h1><img src="/logo.svg" alt="Bolsa Sintética"></h1>'
    expect(await verifyShow('Sol + Luna', `<title>Sol y Luna</title>${logo}<p>${officialQuote}</p>`)).toEqual([])
    expect(await verifyShow('Sol + Luna', `${logo}<h1>Sol y Luna</h1><p>${officialQuote}</p>`)).toEqual([])
  })

  it('confirms which heading is visible after a styled site header is skipped', async () => {
    const title = 'Sol y Luna - Bolsa Sintética'
    const header = `<title>${title}</title><h1>Bolsa Sintética</h1>`
    const actual = `${header}<h1>Otra obra</h1><p>${officialQuote}</p>`
    const html = `<style>.mobile-only { display: none }</style>${header}<h1 class="mobile-only">Sol y Luna</h1><h1>Otra obra</h1><p>${officialQuote}</p>`
    const render = vi.fn(async () => ({ ...await readHtml(actual)(officialUrl, sites), url: officialUrl }))
    expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(officialUrl, officialQuote)], { ...facts, name: 'Sol + Luna' }, readHtml(html), render)))
      .toEqual([`Official page does not name "Sol + Luna" (page title: "${title}"; H1: "Bolsa Sintética"): ${officialUrl}`])
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('renders when a styled intervening H1 might hide otherwise corroborating headings', async () => {
    const header = '<title>Sol y Luna - Bolsa Sintética</title><h1>Bolsa Sintética</h1>'
    const listing = `<h1>Sol y Luna</h1><p>${officialQuote}</p>`
    const html = `<style>.mobile-only { display: none }</style>${header}<h1 class="mobile-only">Agenda</h1>${listing}`
    const render = vi.fn(async () => ({ ...await readHtml(`${header}${listing}`)(officialUrl, sites), url: officialUrl }))
    expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(officialUrl, officialQuote)], { ...facts, name: 'Sol + Luna' }, readHtml(html), render)))
      .toEqual([])
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('only renders after a missing excerpt or an unreadable page and reuses that render for later evidence', async () => {
    const html = fixture('official-page-rendered')
    const makeRenderer = (rendered = html, url = officialUrl) => vi.fn(async (_url: string, _sites: ReadonlySet<string>, _excerpts: readonly RegExp[]) =>
      ({ ...await readHtml(rendered)(url, sites), url }))
    const render = makeRenderer()
    const evidenceItems = [evidence(officialUrl, officialQuote), evidence(officialUrl, 'Teatro Sintético, Pasaje Ficticio 1234', ['venue'])]
    expect(await Effect.runPromise(verifyOfficialPagesEffect(evidenceItems, facts, readHtml(SHOWTIMES), render))).toEqual([])
    expect(render).not.toHaveBeenCalled()
    expect(await Effect.runPromise(verifyOfficialPagesEffect(evidenceItems, facts, readHtml(fixture('official-page-shell')), render))).toEqual([])
    expect(render).toHaveBeenCalledTimes(1)
    expect(await Effect.runPromise(verifyOfficialPagesEffect([...evidenceItems].reverse(), facts, readHtml('<body></body>'), render))).toEqual([])
    expect(render).toHaveBeenCalledTimes(2)
    for (const [, , excerpts] of render.mock.calls) {
      expect(excerpts).toHaveLength(2)
      for (const { excerpt } of evidenceItems) expect(excerpts.some(regex => regex.test(normalizePageText(excerpt)))).toBe(true)
    }
    for (const prefix of ['OCULTO', 'OTRO', 'CARROUSEL', 'TRANSPARENTE']) {
      const excerpt = `${prefix} 23 NOVIEMBRE 21:00`
      expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(officialUrl, excerpt)], facts, readHtml('<body></body>'), render)))
        .toEqual([`Official page evidence must be an excerpt of the page's visible text: ${officialUrl}`])
    }
    const wrong = makeRenderer(html.replace('Forever Sintético', 'Otra obra'))
    expect(await Effect.runPromise(verifyOfficialPagesEffect([evidenceItems[0]], facts, readHtml('<body></body>'), wrong)))
      .toEqual([`Official page does not name "Forever Sintético" (page title: "Sala de Prueba"; H1: "Otra obra"): ${officialUrl}`])
    const denied = vi.fn(async () => ({ ...await readHtml(html)(officialUrl, sites), url: 'https://unapproved.example.net/event' }))
    expect((await Effect.runPromise(verifyOfficialPagesEffect([evidenceItems[0]], facts, readHtml('<body></body>'), denied)))[0])
      .toContain('redirected to unapproved.example.net')
    const wall = vi.fn(async () => ({ visible: `Verify you are human: ${officialQuote}`, title: 'Just a moment...', h1: facts.name, url: officialUrl }))
    expect((await Effect.runPromise(verifyOfficialPagesEffect([evidenceItems[0]], facts, readHtml('<body></body>'), wall)))[0])
      .toContain('Official page could not be read')
  })

  it('does not combine an earlier date with an address added after hydration', async () => {
    const address = 'Teatro Sintético, Pasaje Ficticio 1234'
    const staticPage = readHtml(`<h1>${facts.name}</h1><p>${officialQuote}</p>`)
    const renderedPage = vi.fn(async () => ({ h1: facts.name, title: null, visible: address, url: officialUrl }))
    const items = [evidence(officialUrl, officialQuote), evidence(officialUrl, address, ['venue'])]
    for (const citations of [items, [...items].reverse()]) {
      expect(await Effect.runPromise(verifyOfficialPagesEffect(citations, facts, staticPage, renderedPage)))
        .toEqual([`Official page evidence must be an excerpt of the page's visible text: ${officialUrl}`])
    }
    expect(renderedPage).toHaveBeenCalledTimes(2)
  })

  it('ignores a sidebar recommendation and later H1s when the primary show differs', async () => {
    const html = `<head><title>Entradas para Otra Obra</title></head><body>
      <h1>Otra Obra</h1><p>${officialQuote}</p>
      <aside><h1>Sol y Luna</h1><p>${officialQuote}</p></aside></body>`
    expect(await verifyShow('Sol + Luna', html)).toEqual([
      `Official page does not name "Sol + Luna" (page title: "Entradas para Otra Obra"; H1: "Otra Obra"): ${officialUrl}`,
    ])
  })

  it('holds a page whose H1 names another show even when its title names this one', async () => {
    const html = `<head><title>Sol y Luna</title></head><body><h1>Otra Obra</h1><p>${officialQuote}</p></body>`
    expect(await verifyShow('Sol + Luna', html)).toEqual([
      `Official page does not name "Sol + Luna" (page title: "Sol y Luna"; H1: "Otra Obra"): ${officialUrl}`,
    ])
  })

  it('holds a calendar whose primary heading identifies the calendar rather than either show', async () => {
    const html = `<head><title>Teatro Flores | Cartelera</title></head><body><h1>Cartelera</h1>
      <section><h1>Sol y Luna</h1><p>MARTES 24 NOVIEMBRE 21:00</p></section>
      <section><h4>Otra Obra</h4><p>${officialQuote}</p></section></body>`
    for (const name of ['Sol + Luna', 'Otra Obra']) {
      expect(await verifyShow(name, html)).toEqual([
        `Official page does not name "${name}" (page title: "Teatro Flores | Cartelera"; H1: "Cartelera"): ${officialUrl}`,
      ])
    }
  })

  it('accepts a single show whose schedule sits outside its header div', async () => {
    const html = `<head><title>Teatro Flores</title></head><body><h1 hidden>Otra Obra</h1>
      <div class="header"><h1>Sol y Luna</h1><span>Teatro Flores</span></div>
      <p>${officialQuote}</p></body>`
    expect(await verifyShow('Sol + Luna', html)).toEqual([])
    expect(await verifyShow('Otra Obra', html)).toEqual([
      `Official page does not name "Otra Obra" (page title: "Teatro Flores"; H1: "Sol y Luna"): ${officialUrl}`,
    ])
  })

  it('rejects an excerpt the page lacks, hidden text, a failed read, a private address, and a too-short excerpt', async () => {
    let reads = 0
    const reasons = await Effect.runPromise(verifyOfficialPagesEffect([
      evidence('https://teatro.example.org/obra', 'MARTES 23 NOVIEMBRE 21:00'), // hidden on the page
      evidence('https://teatro.example.org/obra', 'VIERNES 23 NOVIEMBRE 21:00'),
      evidence('https://down.example.org/obra', 'LUNES 23 NOVIEMBRE 21:00', ['date']),
      evidence('https://192.168.0.2/obra', 'LUNES 23 NOVIEMBRE', ['date']),
      evidence('https://teatro.example.org/obra', 'el 23', ['date']),
    ], facts, async (url, allowed) => { reads++; if (url.includes('down')) throw new Error('answered 503'); return readHtml(SHOWTIMES)(url, allowed) }))
    expect(reasons).toEqual([
      'Official page evidence must be an excerpt of the page\'s visible text: https://teatro.example.org/obra',
      'Official page evidence must be an excerpt of the page\'s visible text: https://teatro.example.org/obra',
      'Official page could not be read: https://down.example.org/obra (answered 503)',
      'Official page must be a public HTTPS address: https://192.168.0.2/obra',
      'Official page excerpt is too short to verify: https://teatro.example.org/obra',
    ])
    expect(reads).toBe(2) // one read per page
  })

  it('fetches without cookies or credentials and re-checks every redirect', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const fetcher = (async (url: string, init?: RequestInit) => {
      requests.push({ url, init })
      if (url.endsWith('/old')) return new Response(null, { status: 301, headers: { location: '/obra' } })
      if (url.endsWith('/sneaky')) return new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/latest' } })
      return page(SHOWTIMES)
    }) as typeof fetch
    expect((await readOfficialPage('https://teatro.example.org/old', sites, fetcher)).visible).toContain('LUNES 23 NOVIEMBRE')
    expect(requests.map(request => request.url)).toEqual(['https://teatro.example.org/old', 'https://teatro.example.org/obra'])
    expect(requests[0].init).toMatchObject({ redirect: 'manual' })
    expect(Object.keys(requests[0].init!.headers as object).map(key => key.toLowerCase())).not.toContain('cookie')
    expect(requests[0].init!.credentials).toBeUndefined()
    await expect(readOfficialPage('https://teatro.example.org/sneaky', sites, fetcher)).rejects.toThrow('not a public HTTPS page')
  })

  it('reports a seller waiting room without ever requesting it', async () => {
    const url = 'https://www.passline.com/eventos-plano/obra'
    const fetches: string[] = []
    const fetcher = (async (requested: string) => {
      fetches.push(requested)
      return new Response(null, { status: 302, headers: { location: 'https://passline.queue-it.net/?c=passline' } })
    }) as typeof fetch
    expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(url, 'LUNES 23 NOVIEMBRE 21:00')], facts,
      (target, allowed) => readOfficialPage(target, allowed, fetcher)))).toEqual([
      `Official page could not be read: ${url} (the page sits behind a waiting room; cite another official page)`,
    ])
    expect(fetches).toEqual([url])
  })

  it('counts only the venue\'s site, sites cited posts link to, the post-backed ticket site, and known ticket sellers', () => {
    const allowed = officialSites({ website: 'teatropicadero.com.ar', ticketUrl: 'https://entradas.sala.com.ar/x',
      captions: ['Info en www.organizador.org.ar/obra y https://linktr.ee/sala, también https://www.instagram.com/sala'] })
    expect(siteOf('www.teatropicadero.com.ar')).toBe('teatropicadero.com.ar')
    for (const site of ['teatropicadero.com.ar', 'sala.com.ar', 'organizador.org.ar', 'plateanet.com', 'alternativateatral.com']) expect(allowed.has(site), site).toBe(true)
    for (const site of ['linktr.ee', 'instagram.com', 'example.org']) expect(allowed.has(site), site).toBe(false)
    expect(officialSites({ website: 'https://www.facebook.com/sala' }).has('facebook.com')).toBe(false)
  })

  it('reads a scheme-less ticket domain next to caption punctuation, but only if cited', () => {
    const source = { website: 'https://sala.example.org' }
    expect(officialSites({ ...source, captions: ['Link en la bio'] }).has('entradas-sinteticas.net')).toBe(false)
    for (const ending of ['', '.', ',', '!', '…']) {
      expect(officialSites({ ...source, captions: [`Entradas en www.entradas-sinteticas.net${ending} Link en la bio`] })
        .has('entradas-sinteticas.net'), ending).toBe(true)
    }
  })

  it('refuses a page or a redirect off the allowed sites, and social or wrapper hosts even when a venue links them', async () => {
    const reasons = await Effect.runPromise(verifyOfficialPagesEffect([
      evidence('https://agenda.example.net/forever', 'LUNES 23 NOVIEMBRE 21:00'),
      evidence('https://teatro-example-org.translate.goog/obra', 'LUNES 23 NOVIEMBRE 21:00'),
    ], { ...facts, sites: new Set([...sites, 'translate.goog']) }, readHtml(SHOWTIMES)))
    expect(reasons).toEqual([
      "Official page must be on the venue's website, a site a cited post links to, the post-backed ticket site, or a known ticket seller: https://agenda.example.net/forever",
      "Official page must be on the venue's website, a site a cited post links to, the post-backed ticket site, or a known ticket seller: https://teatro-example-org.translate.goog/obra",
    ])
    const fetcher = (async () => new Response(null, { status: 302, headers: { location: 'https://agenda.example.net/forever' } })) as unknown as typeof fetch
    await expect(readOfficialPage('https://www.teatro.example.org/obra', sites, fetcher)).rejects.toThrow('redirected to agenda.example.net')
  })

  // Trimmed from revamos.com's event page (2026-11-18): Next.js streams the event into hidden segment S:2, and `$RS` moves it
  // into placeholder P:2. Flashpass has the same shape.
  const STREAMED = `<html><body><nav>Revamos Eventos Productoras Ingresar</nav><template id="P:2"></template><div hidden id="other">OCULTO 27/11/2026</div>
    <template><p>PLANTILLA 27/11/2026</p></template>
    <div hidden id="S:2"><h1>PositHIVo 6.0 Kiki Ball - La Era Roja</h1><div><h6>19:00 - 27/11/2026</h6><h6>Maquinal - Anchorena 364 - Abasto</h6></div></div>
    <script>$RS("S:2","P:2")</script></body></html>`
  const kiki = (html: string) => Effect.runPromise(verifyOfficialPagesEffect(
    [evidence('https://www.revamos.com/eventos/kiki-ball', '19:00 - 27/11/2026')],
    { name: 'PositHIVo 6.0 Kiki Ball - La Era Roja', date: '2026-11-27', time: '19:00', sites: new Set(['revamos.com']) },
    (url, allowed) => readOfficialPage(url, allowed, (async () => page(html)) as unknown as typeof fetch)))

  it('reads a React streaming segment the page reveals, but not other hidden elements or templates', async () => {
    const text = visibleText(STREAMED)
    expect(text).toContain('19:00 - 27/11/2026')
    expect(text).not.toContain('OCULTO')
    expect(text).not.toContain('PLANTILLA')
    expect(await kiki(STREAMED)).toEqual([])
  })

  it('moves a completed boundary into place and drops its fallback', async () => {
    const boundary = `<html><body><nav>Revamos Eventos Productoras Ingresar</nav><main><!--$?--><template id="B:0"></template><p>CARGANDO 01/01/2026</p><!--$--><i>anidado</i><!--/$--><!--/$--></main>
      <div hidden id="S:0"><h1>PositHIVo 6.0 Kiki Ball - La Era Roja</h1><h6>19:00 - 27/11/2026</h6></div>
      <script>$RC( 'B:0' , 'S:0' )</script></body></html>`
    const text = visibleText(boundary)
    expect(text).not.toContain('CARGANDO')
    expect(text).not.toContain('anidado')
    expect(await kiki(boundary)).toEqual([])
    // Without the boundary the segment has nowhere to go and stays hidden.
    expect(visibleText(boundary.replace('<template id="B:0"></template>', ''))).not.toContain('27/11/2026')
  })

  it('keeps a segment hidden when it is moved into a parent segment the page never reveals', async () => {
    // Revamos' real shape: P:2 sits inside S:1, which only `$RC("B:1","S:1")` reveals.
    const nested = `<html><body><nav>Revamos Eventos Productoras Ingresar</nav><!--$?--><template id="B:1"></template><p>CARGANDO</p><!--/$-->
      <div hidden id="S:1"><template id="P:2"></template></div>
      <div hidden id="S:2"><h1>PositHIVo 6.0 Kiki Ball - La Era Roja</h1><h6>19:00 - 27/11/2026</h6></div>
      <script>$RS("S:2","P:2")</script></body></html>`
    expect(await kiki(nested)).toEqual(["Official page evidence must be an excerpt of the page's visible text: https://www.revamos.com/eventos/kiki-ball"])
    expect(await kiki(nested.replace('$RS("S:2","P:2")', '$RS("S:2","P:2");$RC("B:1","S:1")'))).toEqual([])
  })

  it('keeps a streaming segment hidden when the page never reveals it', async () => {
    const unrevealed = STREAMED.replace(`<script>$RS("S:2","P:2")</script>`, `<script>$RC("B:1","S:1")</script>`)
    expect(visibleText(unrevealed)).not.toContain('27/11/2026')
    expect(await kiki(unrevealed)).toEqual(["Official page evidence must be an excerpt of the page's visible text: https://www.revamos.com/eventos/kiki-ball"])
  })

  const CAMARIN_URL = 'https://www.elcamarindelasmusas.com/event/42?eventDateId=17'
  const CAMARIN_SITES = new Set(['elcamarindelasmusas.com'])
  const CAMARIN_EXCERPT = 'Empieza el sáb 28 de nov 2026 22:00 - 23:15 hs'
  function camarinPage(id = '17', title = facts.name, extra = '') {
    const dates = [
      { id: 16, start: '2026-11-22T01:00:00.000Z', end: '2026-11-22T02:15:00.000Z' },
      { id: 17, start: '2026-11-29T01:00:00.000Z', end: '2026-11-29T02:15:00.000Z' },
    ]
    const data = {
      page: '/event/[eventId]', query: { eventId: '42', eventDateId: id },
      props: { pageProps: { event: { id: 42, title, isExternal: false, isFinished: false, timezone: 'America/Buenos_Aires',
        Dates: dates, description: 'OCULTO 28/11/2026' },
        related: [{ id: 17, name: 'OTRA OBRA 28/11/2026' }] } },
    }
    const startLine = id === '17' ? CAMARIN_EXCERPT : 'Empieza el sáb 21 de nov 2026 22:00 - 23:15 hs'
    return `<h1>${title}</h1><p>${startLine}</p><p hidden>OCULTO 22:00</p><footer><a href="https://fanz.com.ar">Fanz</a></footer>${extra}
      <script type="application/json" id="__NEXT_DATA__">${JSON.stringify(data)}</script>`
  }
  const camarinRead = readHtml
  const fanzJson = (html: string) => /<script[^>]*>(.*)<\/script>/.exec(html)?.[1] ?? ''
  const camarinRender = (html: string) => async (url: string, sites: ReadonlySet<string>) => {
    const { title, visible, h1 } = await camarinRead(html)(url, sites)
    return renderedPageRead(url, { url, title: title ?? '', visible, headings: h1 ? [h1] : [], siteName: null,
      fanzLinks: ['https://fanz.com.ar'], fanzJson: fanzJson(html), singleDate: '', challenge: false })
  }

  it('reads only El Camarín’s URL-selected date from the current Fanz event, not other JSON or hidden text', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-20T12:00:00Z'))
    const fixture = camarinPage()
    const url = CAMARIN_URL
    const excerpt = CAMARIN_EXCERPT
    const allowed = CAMARIN_SITES
    const fetcher = (async () => page(fixture)) as typeof fetch
    const read = await readOfficialPage(url, allowed, fetcher)
    expect(read).toMatchObject({ visible: expect.stringContaining('Forever Sintético'), title: null,
      selected: { date: '2026-11-28', time: '22:00', text: excerpt, title: facts.name } })
    expect(JSON.stringify(read)).not.toMatch(/sáb 21|OCULTO|OTRA OBRA/)
    const early = (async () => page(fixture.replaceAll('2026-11-29T0', '2026-12-05T0')
      .replace(excerpt, 'Empieza el vie 04 de dic 2026 22:00 - 23:15 hs'))) as typeof fetch
    expect(await readOfficialPage(url, allowed, early)).toMatchObject({
      selected: { date: '2026-12-04', text: 'Empieza el vie 04 de dic 2026 22:00 - 23:15 hs' },
    })
    const verify = (time: string, date = '2026-11-28', quote = excerpt, fields?: Array<'date' | 'time' | 'venue'>) => Effect.runPromise(
      verifyOfficialPagesEffect([evidence(url, quote, fields)], { ...facts, date, time, sites: allowed },
        (target, sites) => readOfficialPage(target, sites, fetcher), camarinRender(fixture)))
    expect(await verify('22:00')).toEqual([])
    expect(await verify('23:15')).toEqual([`Official page excerpt does not state the time 23:15: ${url}`])
    expect(await verify('22:15')).toEqual([`Official page excerpt does not state the time 22:15: ${url}`])
    expect(await verify('23:15', '2026-11-28', '23:15 hs', ['time']))
      .toEqual([`Official page excerpt does not state the day 28: ${url}`])
    expect(await verify('22:00', '2026-12-28')).toEqual([`Official page excerpt does not state the month 12: ${url}`])
    expect(await verify('22:00', '2026-11-21', excerpt, ['time']))
      .toEqual([`Official page excerpt does not state the day 21: ${url}`])
    expect(await verify('22:00', '2026-11-28', excerpt, ['venue']))
      .toEqual([`The selected performance excerpt can only support date and time: ${url}`])
    for (const unsupported of [url.replace('17', '16'), url.replace('/42', '/99'), `${url}&eventDateId=16`]) {
      expect(await readOfficialPage(unsupported, allowed, fetcher), unsupported).toMatchObject({ selected: null })
    }
    expect((await readOfficialPage(url.split('?')[0], allowed, fetcher)).selected).toBeUndefined()
    const venueUrl = 'https://teatro.example.org/event/42-synthetic-show?eventDateId=17'
    const sluggified = fixture.replace('"eventId":"42"', '"eventId":"42-synthetic-show"')
    expect((await camarinRead(sluggified)(venueUrl, sites)).selected).toMatchObject({ date: '2026-11-28', time: '22:00' })
    const unbranded = sluggified.replace('https://fanz.com.ar', 'https://not-fanz.example.org')
    expect((await camarinRead(unbranded)(venueUrl, sites)).selected).toMatchObject({ date: '2026-11-28', time: '22:00' })
    expect((await camarinRead(unbranded.replace('"Dates":', '"changedDates":'))(venueUrl, sites)).selected).toBeNull()
    expect((await camarinRead(unbranded.replace('"page":"/event/[eventId]"', '"page":"/other"'))(venueUrl, sites)).selected).toBeNull()
    vi.mocked(Date.now).mockReturnValue(Date.parse('2026-11-29T01:00:00Z'))
    expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(venueUrl, CAMARIN_EXCERPT)],
      { ...facts, date: '2026-11-28', time: '22:00' }, readHtml(unbranded))))
      .toEqual([`Official page could not verify the selected future Fanz performance: ${venueUrl}`])
  })

  it('does not accept Fanz JSON or a hidden date-picker line as visible evidence', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-20T12:00:00Z'))
    const raw = camarinPage().replace(`<p>${CAMARIN_EXCERPT}</p>`, `<p hidden>${CAMARIN_EXCERPT}</p>`)
    const read = readHtml(raw)
    const verify = (renderPage?: Parameters<typeof verifyOfficialPagesEffect>[3]) => Effect.runPromise(verifyOfficialPagesEffect(
      [evidence(CAMARIN_URL, CAMARIN_EXCERPT)], { ...facts, sites: CAMARIN_SITES, date: '2026-11-28', time: '22:00' }, read, renderPage))
    expect(await verify()).toEqual([`Official page date or time evidence must quote the selected future performance: ${CAMARIN_URL}`])
    expect(await verify(camarinRender(camarinPage()))).toEqual([])
  })

  it('verifies a Fanz single-date card only from the matching rendered start line, before start', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-20T12:00:00Z'))
    const url = 'https://teatro.example.org/event/42-synthetic-show?eventDateId=17'
    const line = 'Sábado, 28 de Noviembre\n22:00 - 23:15 hs'
    const raw = camarinPage().replace(`<p>${CAMARIN_EXCERPT}</p>`, `<style>.inactive { display: none }</style>
      <div class="styles_singleDateContainer__synthetic inactive">${line}</div>`).replace('"eventId":"42"', '"eventId":"42-synthetic-show"')
      .replace('{"id":16,"start":"2026-11-22T01:00:00.000Z","end":"2026-11-22T02:15:00.000Z"},', '')
    const verify = (shown: string, quote = line, at = '22:00', h1 = facts.name, date = '2026-11-28') => Effect.runPromise(verifyOfficialPagesEffect(
      [evidence(url, quote)], { ...facts, date, time: at }, readHtml(raw), async () => renderedPageRead(url, {
        url, visible: `${facts.name}\n${line}`, title: facts.name, headings: [h1], siteName: null, fanzLinks: ['https://fanz.com.ar'],
        fanzJson: fanzJson(raw), singleDate: shown, challenge: false,
      })))
    const missing = [`Official page date or time evidence must quote the selected future performance: ${url}`]
    expect(await verify(line)).toEqual([])
    expect(await verify(line, line, '22:00', facts.name, '2027-11-28'))
      .toEqual([`Official page excerpt does not state the selected performance date 2027-11-28: ${url}`])
    expect(await verify('')).toEqual(missing) // CSS-hidden in static HTML, and unrelated body text cannot stand in for the rendered card
    expect(await verify(line, line, '23:15')).toEqual([`Official page excerpt does not state the time 23:15: ${url}`])
    expect((await verify(line, line, '22:00', 'Otra obra'))[0]).toContain('H1: "Otra obra"')
    clock.mockReturnValue(Date.parse('2026-11-29T01:00:00Z'))
    expect(await verify(line)).toEqual([`Official page could not verify the selected future Fanz performance: ${url}`])
  })

  it('holds instead of using body text when a Fanz route changes', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-20T12:00:00Z'))
    const html = camarinPage().replace('https://fanz.com.ar', 'https://not-fanz.example.org')
    for (const [url, fixture] of [
      [CAMARIN_URL, html.replace('"page":"/event/[eventId]"', '"page":"/functions/[eventId]"')],
      [CAMARIN_URL.replace('/event/', '/functions/'), html],
      [CAMARIN_URL, html.replace(fanzJson(html), JSON.stringify({ page: '/functions/[eventId]', query: { eventId: '42', eventDateId: '17' },
        props: { pageProps: { event: { id: 42, Dates: null } } } }))],
    ]) {
      const read = readHtml(fixture)
      const render = async () => renderedPageRead(url, {
        url, visible: CAMARIN_EXCERPT, title: facts.name, headings: [facts.name], siteName: null, fanzLinks: [],
        fanzJson: fanzJson(fixture), singleDate: '', challenge: false,
      })
      expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(url, CAMARIN_EXCERPT)],
        { ...facts, date: '2026-11-28', time: '22:00', sites: CAMARIN_SITES }, read, render)))
        .toEqual([`Official page could not verify the selected future Fanz performance: ${url}`])
    }
  })

  it('uses ordinary verification for a page that merely shares the URL shape', async () => {
    const url = 'https://teatro.example.org/event/42?eventDateId=17'
    expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(url, officialQuote)], facts, readHtml(SHOWTIMES)))).toEqual([])
  })

  it('does not downgrade a selected performance to a general schedule after redirect', async () => {
    const url = 'https://teatro.example.org/event/42?eventDateId=17'
    const final = 'https://teatro.example.org/schedule'
    const html = `<h1>${facts.name}</h1><p>${officialQuote}</p>`
    const fetcher = ((requested: string) => Promise.resolve(requested === url
      ? new Response(null, { status: 302, headers: { location: final } }) : page(html))) as typeof fetch
    expect((await readOfficialPage(url, sites, fetcher)).selected).toBeNull()
    expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(url, officialQuote)], facts,
      (target, sites) => readOfficialPage(target, sites, fetcher), async () => ({ ...await readHtml(html)(final, sites), url: final }))))
      .toEqual([`Official page could not verify the selected future Fanz performance: ${url}`])
  })

  it('does not let ordinary El Camarín page text stand in for the selected performance', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-20T12:00:00Z'))
    const quote = 'viernes 27 de noviembre 20:30'
    const read = camarinRead(camarinPage('17', facts.name, `<p>${quote}</p>`))
    expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(CAMARIN_URL, quote)],
      { ...facts, date: '2026-11-27', time: '20:30', sites: CAMARIN_SITES }, read)))
      .toEqual([`Official page date or time evidence must quote the selected future performance: ${CAMARIN_URL}`])
  })

  it('binds the selected performance to its own title, not another show appearing on the page', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-20T12:00:00Z'))
    const html = camarinPage('17', 'Otra Obra Sintética', '<aside>También en cartel: Forever Sintético</aside>')
    expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(CAMARIN_URL, CAMARIN_EXCERPT)],
      { ...facts, date: '2026-11-28', time: '22:00', sites: CAMARIN_SITES }, camarinRead(html), camarinRender(html))))
      .toEqual([`Official page selected performance is not for "${facts.name}" (page title: "Otra Obra Sintética"): ${CAMARIN_URL}`])
  })

  it('keeps a standalone y significant in the title of a selected El Camarín performance', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-20T12:00:00Z'))
    const html = camarinPage('17', 'María y José')
    const verify = (name: string) => Effect.runPromise(verifyOfficialPagesEffect([evidence(CAMARIN_URL, CAMARIN_EXCERPT)],
      { ...facts, name, date: '2026-11-28', time: '22:00', sites: CAMARIN_SITES }, camarinRead(html), camarinRender(html)))
    expect(await verify('Maria y Jose')).toEqual([])
    expect(await verify('María José')).toEqual([
      `Official page selected performance is not for "María José" (page title: "María y José"): ${CAMARIN_URL}`,
    ])
  })

  it('does not synthesize a past performance while the same event still has a future one', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-23T12:00:00Z'))
    const pastUrl = CAMARIN_URL.replace('17', '16')
    const pastExcerpt = 'Empieza el sáb 21 de nov 2026 22:00 - 23:15 hs'
    const past = camarinRead(camarinPage('16', facts.name, `<p>${pastExcerpt}</p>`))
    expect(await past(pastUrl, CAMARIN_SITES)).toMatchObject({ selected: null })
    expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(pastUrl, pastExcerpt)],
      { ...facts, date: '2026-11-21', time: '22:00', sites: CAMARIN_SITES }, past)))
      .toEqual([`Official page could not verify the selected future Fanz performance: ${pastUrl}`])
    expect(await camarinRead(camarinPage())(CAMARIN_URL, CAMARIN_SITES)).toMatchObject({ selected: { text: CAMARIN_EXCERPT } })
  })

  it('names a bot check or an empty page as unreadable', async () => {
    // Trimmed from plateanet.com (2026-11-18): Incapsula answers automated readers with this stub.
    const incapsula = '<html><head><META NAME="robots" CONTENT="noindex,nofollow"><script src="/_Incapsula_Resource?SWJIYLWA=0"></script><body></body></html>'
    const cloudflare = '<html><head><title>Just a moment...</title></head><body><p>Verificando 23 noviembre</p><script>window._cf_chl_opt = {}</script></body></html>'
    for (const html of [incapsula, cloudflare, cloudflare.replace('Verificando', 'Verificando '.repeat(30)), '<html><body> </body></html>']) {
      const reasons = await Effect.runPromise(verifyOfficialPagesEffect([evidence('https://www.plateanet.com/obra/1', 'LUNES 23 NOVIEMBRE 21:00')],
        facts, (url, allowed) => readOfficialPage(url, allowed, (async () => page(html)) as unknown as typeof fetch)))
      expect(reasons).toEqual(['Official page could not be read: https://www.plateanet.com/obra/1 (the site shows a bot check or an empty page to automated readers; cite another official page)'])
    }
  })

  it('reads a short real listing page that carries an Incapsula script', async () => {
    const listing = SHOWTIMES.replace('</head>', '<script src="/_Incapsula_Resource?SWJIYLWA=0"></script></head>')
    expect(normalizePageText(visibleText(listing)).length).toBeLessThan(200)
    const reasons = await Effect.runPromise(verifyOfficialPagesEffect([evidence('https://www.plateanet.com/obra/1', 'LUNES 23 NOVIEMBRE 21:00')],
      facts, (url, allowed) => readOfficialPage(url, allowed, (async () => page(listing)) as unknown as typeof fetch)))
    expect(reasons).toEqual([])
  })

  it('refuses non-HTML bodies, error statuses, and oversized pages', async () => {
    const answer = (response: Response) => (async () => response) as unknown as typeof fetch
    await expect(readOfficialPage('https://a.example.org/', new Set(['example.org']), answer(page('x', { headers: { 'content-type': 'application/pdf' } })))).rejects.toThrow('not an HTML page')
    await expect(readOfficialPage('https://a.example.org/', new Set(['example.org']), answer(page('x', { status: 404 })))).rejects.toThrow('answered 404')
    await expect(readOfficialPage('https://a.example.org/', new Set(['example.org']), answer(page('x'.repeat(2_097_153))))).rejects.toThrow('page exceeds 2 MB')
  })
})
