import { afterEach, describe, expect, it, vi } from 'vitest'
import { Effect } from 'effect'
import { readFileSync } from 'node:fs'
import { normalizePageText, officialSites, publicPageUrl, readOfficialPage, renderedPageRead, siteOf, verifyOfficialPagesEffect, visibleText, type PageFacts } from './official-page.ts'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), 'utf8')

const page = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, ...init })
const readHtml = (html: string) => (url: string, sites: ReadonlySet<string>) =>
  readOfficialPage(url, sites, (async () => page(html)) as typeof fetch)
const sites = officialSites({ website: 'https://www.teatro.example.org', captions: ['Entradas: https://down.example.org/obra'] })
const facts = { name: 'Forever Sintético', date: '2026-11-23', time: '21:00', sites, venueWebsite: 'https://www.teatro.example.org' }
const SHOWTIMES = `<html><head><title>Sala Sintética</title><script>var s = "LUNES 1 ENERO 09:00"</script></head><body><h1>Forever&nbsp;Sint&eacute;tico</h1>
  <div class="sp-funcion-fecha">
      LUNES 23 NOVIEMBRE
  </div>
  <div class="sp-funcion-hora">21:00</div>
  <p hidden>LUNES 23 DE NOVIEMBRE 21:00</p><p style="display: none">MIÉRCOLES 25 NOVIEMBRE</p>
  <p>Teatro&nbsp;Sint&eacute;tico, Pasaje Ficticio 1234</p>
</body></html>`
const evidence = (url: string, excerpt: string, fields: Array<'date' | 'time' | 'venue' | 'doors_time'> = ['date', 'time']) => ({ kind: 'official_page' as const, url, fields, excerpt })
describe('official-page evidence', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it.each(['Puerta 20 hs | Show 20:30 hs', 'Acceso:20 (por boletería) | Música a las 20:30'])(
    'verifies both clocks the agent cites on one line: %s', async excerpt => {
      const at = { ...facts, time: '20:30', doorsTime: '20:00' }
      const read = readHtml(`<h1>${facts.name}</h1><p>${excerpt}</p>`)
      expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(officialUrl, excerpt, ['doors_time', 'time'])], at, read))).toEqual([])
    })

  it.each([
    ['Lunes 23 de noviembre, de 20 a 24 h', '20:00', '00:00'],
    ['Lunes 23 - 21 hs', '21:00', '23:00'],
    ['Lunes 23 de noviembre: 18 a 21 hs', '18:00', '21:00'],
    ['Lunes 23 de noviembre, 18–21 hs', '18:00', '21:00'],
    ['Show 21 hs $8000 anticipada', '21:00', '20:00'],
    ['Precios: 10–15:50 USD. Show: 21 hs', '21:00', '10:00'],
    ['Duración: de 2 a 3 horas. Show: 21 hs', '21:00', '02:00'],
    ['de 9 a 13 horas. Show: 13 horas', '13:00', '12:00'],
    ['de 8 a 11 pm. Puerta: 21 hs', '21:00', '23:00'],
  ])('uses shared clock rules without losing the page date in %s', async (excerpt, time, invalid) => {
    const read = readHtml(`<h1>${facts.name}</h1><p>${excerpt}</p>`)
    const citation = evidence(officialUrl, excerpt, ['time'])
    const verify = (time: string) => Effect.runPromise(verifyOfficialPagesEffect([citation], { ...facts, time }, read))
    expect(await verify(time)).toEqual([])
    expect(await verify(invalid)).toEqual([`Official page excerpt does not state the time ${invalid}: ${officialUrl}`])
  })

  it.each([
    ['Viernes', 'states a weekday that does not match 2026-11-23'],
    ['Diciembre', 'does not state the month 11'],
    ['2027', 'does not state the year 2026'],
    ['Lunes', null],
    ['Noviembre', null],
    ['2026', null],
  ])('checks a partial calendar constraint before a clock with no day number: %s', async (prefix, reason) => {
    const clock = 'Show 21:00'
    const line = `${prefix}: ${clock}`
    const read = readHtml(`<h1>${facts.name}</h1><p>${line}</p>`)
    for (const quote of [line, clock]) {
      expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(officialUrl, quote, ['time'])], facts, read)))
        .toEqual(reason ? [`Official page excerpt ${reason}: ${officialUrl}`] : [])
    }
  })

  it.each(['/', '|'])('rejects alternative performance clocks with parenthetical notes and a %s separator', async separator => {
    const first = '18:00 (primera función)'
    const line = `Lunes 23 de noviembre: ${first} ${separator} 21:00 (segunda función)`
    const read = readHtml(`<h1>${facts.name}</h1><p>${line}</p>`)
    const at = { ...facts, doorsTime: '18:00' }
    const reason = `Official page excerpt lists multiple dates or start times; cite the single occurrence's line: ${officialUrl}`
    const verify = (citation: ReturnType<typeof evidence>) => Effect.runPromise(verifyOfficialPagesEffect([citation], at, read))
    expect(await verify(evidence(officialUrl, line, ['date', 'doors_time', 'time']))).toEqual([reason])
    expect(await verify(evidence(officialUrl, first, ['doors_time']))).toEqual([reason])
  })

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
    expect(text).not.toContain('LUNES 23 DE NOVIEMBRE')
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
    const day2 = { ...facts, date: '2026-05-02' }
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
    ['viernes 20/11/26, 21:00 hs', '2026-11-20', '21:00'],
    ['17 de 12 de 2026: Puerta 20 hs | Show 21 hs', '2026-12-17', '21:00'],
    ['17 dic/2026 - Puerta 20 hs | Show 21 hs', '2026-12-17', '21:00'],
    ['viernes 20 de noviembre 21:00 hasta 23:30 hs', '2026-11-20', '21:00'],
    ['Viernes, 20 de Noviembre\n21:00 - 23:30 hs', '2026-11-20', '21:00'],
    ['viernes 20 de noviembre de 21:00 a las 23:30 hs', '2026-11-20', '21:00'],
    ['viernes 20 de noviembre de 21 a 23 hs', '2026-11-20', '21:00'],
    ['20/11/2026 de 21 a 23 hs', '2026-11-20', '21:00'],
    ['20/11/2026 de 21 a 23:30 hs', '2026-11-20', '21:00'],
    ['20/11/2026 21:00-23:30 hs', '2026-11-20', '21:00'],
    ['20/11/2026 21 a 23 hs', '2026-11-20', '21:00'],
    ['viernes 20 a las 21 hs', '2026-11-20', '21:00'],
    ['día 20 a las 21:00', '2026-11-20', '21:00'],
    ['viernes: 20 (función especial) 21:00 hs', '2026-11-20', '21:00'],
    ['sábado el 21 - 18:00 hs', '2026-11-21', '18:00'],
    ['día 21 - 18:00 hs', '2026-11-21', '18:00'],
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
    ['Viernes 20/11 y sábado 21 - 18:00 hs', '2026-11-20', '21:00'],
    ['Viernes 20/11 y sábado el 21 - 18:00 hs', '2026-11-20', '21:00'],
    ['Viernes 20/11 y día 21 - 18:00 hs', '2026-11-20', '21:00'],
    ['20 y 21 de noviembre a las 18:00', '2026-11-21', '18:00'],
    ['Viernes 20 a las 18:00 y 21:00', '2026-11-20', '21:00'],
  ])('asks for a single occurrence when the quote is %s', async (excerpt, date, time) => {
    expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(officialUrl, excerpt)], { ...facts, date, time },
      readHtml(`<h1>${facts.name}</h1><p>${excerpt}</p>`))))
      .toEqual([`Official page excerpt lists multiple dates or start times; cite the single occurrence's line: ${officialUrl}`])
  })

  it.each([
    ['Jueves 17 de diciembre a las 20', ':30', '2026-12-17', '20:00', '20:30'],
    ['Viernes 8 de enero a las 19', '.45 hs', '2027-01-08', '19:00', '19:45'],
    ['Domingo 10 de enero a las 18', '.15', '2027-01-10', '18:00', '18:15'],
    ['Lunes 23 de noviembre a las 9:00', ' p.m.', '2026-11-23', '09:00', '21:00'],
    ['Domingo 10 de enero 18:15', ' horas', '2027-01-10', '18:15', '18:15'],
  ])('requires the complete page clock token when the quote ends at %s', async (excerpt, tail, date, wrongTime, time) => {
    const line = excerpt + tail
    const read = readHtml(`<h1>${facts.name}</h1><p>${line}</p>`)
    for (const fields of [['date'], ['time']] as const) {
      expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(officialUrl, excerpt, [...fields])], { ...facts, date, time: wrongTime }, read)))
        .toEqual([`Official page excerpt cuts a clock token; quote the complete date and time: ${officialUrl}`])
      expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(officialUrl, line, [...fields])], { ...facts, date, time }, read))).toEqual([])
    }
  })

  it.each([
    ['Jueves 17 de diciembre: ', '20 / 22 hs', '2026-12-17', ['20:00', '22:00']],
    ['8 de enero de 2027 a las ', '18 | 21 horas', '2027-01-08', ['18:00', '21:00']],
    ['10 de enero de 2027: ', '17; 19 h', '2027-01-10', ['17:00', '19:00']],
    ['10 de enero de 2027: ', '16/18/20 hs', '2027-01-10', ['16:00', '18:00', '20:00']],
  ] as const)('holds shared-unit time lists: %s%s', async (dateLabel, clocks, date, times) => {
    const line = dateLabel + clocks
    const read = readHtml(`<h1>${facts.name}</h1><p>${line}</p>`)
    for (const time of times) {
      expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(officialUrl, line)], { ...facts, date, time }, read)))
        .toEqual([`Official page excerpt lists multiple dates or start times; cite the single occurrence's line: ${officialUrl}`])
    }
    if (dateLabel.endsWith('a las ')) {
      expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(officialUrl, dateLabel + clocks.slice(0, 2))],
        { ...facts, date, time: times[0] }, read)))
        .toEqual([`Official page excerpt lists multiple dates or start times; cite the single occurrence's line: ${officialUrl}`])
    }
  })

  it.each([
    ['Sábados hasta el ', '20 de diciembre 21 hs', '2026-12-20', '21:00'],
    ['En cartel al ', '08/01/2027 a las 19:30', '2027-01-08', '19:30'],
    ['Disponible hasta el día ', '10 18:15', '2027-01-10', '18:15'],
    ['En cartel hasta ', 'Vie. 8 de enero 19:30', '2027-01-08', '19:30'],
    ['Del 8 a ', '10 de enero 18:15', '2027-01-10', '18:15'],
  ])('does not take a run end as a performance date: %s%s', async (prefix, dateAndTime, date, time) => {
    const line = prefix + dateAndTime
    const read = readHtml(`<h1>${facts.name}</h1><p>${line}</p>`)
    for (const excerpt of [line, ...(dateAndTime === '10 18:15' ? ['día 10 18:15'] : [dateAndTime])]) {
      expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(officialUrl, excerpt)], { ...facts, date, time }, read)))
        .toEqual([`Official page excerpt states the end of a run, not a performance date: ${officialUrl}`])
    }
  })

  it.each([
    ['Puertas:21', '21:00'],
    ['Abrimos las puertas a las 21h', '21:00'],
    ['Ingreso 17h', '17:00'],
    ['Ingreso a las 20.30', '20:30'],
    ['Ingreso a las 20:30. Servimos la cena y luego comienza el espectáculo', '20:30'],
    ['Ingreso a las 20:30. El espectáculo comienza después de la cena.', '20:30'],
    ['Ingreso a las 21. A las 21:45 aproximadamente comienza el espectáculo.', '21:00'],
    ['Apertura de sala 21 hs', '21:00'],
    ['20.30', '20:30'],
  ])('matches a clock in the excerpt cited for doors: %s', async (excerpt, doorsTime) => {
    const name = 'Cuarteto Prisma'
    const url = 'https://sala-nube.example.com/entradas/prisma'
    const available = { ...facts, name, time: null, doorsTime, sites: officialSites({ website: url }) }
    const read = readHtml(`<h1>${name}</h1><p>${excerpt}</p>`)
    const verify = (fields: Parameters<typeof evidence>[2], at: PageFacts = available, page = read, quote = excerpt) =>
      Effect.runPromise(verifyOfficialPagesEffect([evidence(url, quote, fields)], at, page))
    expect(await verify(['doors_time'])).toEqual([])
    expect(await verify(['doors_time'], { ...available, doorsTime: '19:00' })).toEqual([
      `Official page excerpt does not state the doors time 19:00: ${url}`,
    ])
    expect(await verify(['doors_time'], available, readHtml(`<h1>Otro show</h1><p>${excerpt}</p>`)))
      .toEqual([`Official page does not name "${name}" (H1: "Otro show"): ${url}`])
    expect(await verify(['date', 'doors_time'])).toHaveLength(1)
    expect(await verify(['doors_time'], { ...available, doorsDate: '2026-11-24' })).toHaveLength(1)
  })

  it('rejects a fabricated entry quote and a clock present only outside the quoted entry', async () => {
    const read = readHtml(`<h1>${facts.name}</h1><p>Ingreso 20 hs</p><p>Show 21 hs</p>`)
    const at = { ...facts, time: null, doorsTime: '21:00' }
    const verify = (quote: string) => Effect.runPromise(verifyOfficialPagesEffect([evidence(officialUrl, quote, ['doors_time'])], at, read))
    expect(await verify('Ingreso 21 hs')).toEqual([`Official page evidence must be an excerpt of the page's visible text: ${officialUrl}`])
    expect(await verify('Ingreso 20 hs')).toEqual([`Official page excerpt does not state the doors time 21:00: ${officialUrl}`])
  })

  it('checks the full clock in rendered text as well as in static HTML', async () => {
    const excerpt = 'Ingreso 9:00'
    const render = async () => renderedPageRead(officialUrl, { url: officialUrl, title: facts.name, headings: [facts.name], hasH1: true, ogTitle: null,
      siteName: null, visible: `${facts.name}\n${excerpt} p. m.`, challenge: false, fanzJson: '', fanzLinks: [], singleDate: '' })
    const at = { ...facts, time: null, doorsTime: '21:00' }
    const verify = (quote: string) => Effect.runPromise(verifyOfficialPagesEffect(
      [evidence(officialUrl, quote, ['doors_time'])], at, readHtml(`<h1>${facts.name}</h1>`), render))
    expect(await verify(excerpt)).toEqual([`Official page excerpt cuts a clock token; quote the complete date and time: ${officialUrl}`])
    expect(await verify(excerpt + ' p. m.')).toEqual([])
  })

  it.each([
    ['Sábado 22 de noviembre 21:00', false],
    ['Sábados 22 de noviembre 21:00', false],
    ['21:00 Mar. 22', false],
    ['Domingo 22 de noviembre 21:00', true],
    ['Domingos 22 de noviembre 21:00', true],
    ['22 de noviembre 21:00', true],
  ])('checks explicit weekdays on ordinary timing excerpts: %s', async (excerpt, matches) => {
    const date = '2026-11-22'
    for (const field of ['date', 'time'] as const) {
      const reasons = await Effect.runPromise(verifyOfficialPagesEffect([evidence(officialUrl, excerpt, [field])], { ...facts, date },
        readHtml(`<h1>${facts.name}</h1><p>${excerpt}</p>`)))
      expect(reasons).toEqual(matches ? [] : [`Official page excerpt states a weekday that does not match ${date}: ${officialUrl}`])
    }
  })

  it.each([
    ['Miérc.', '17 de diciembre 20:30', '20:30', '2026-12-17', '2025-12-17'],
    ['mier', '13 de enero 19 hs', '19:00', '2028-01-13', '2027-01-13'],
    ['mié.', '13 de enero 19 hs', '19:00', '2028-01-13', '2027-01-13'],
    ['juev', '8 de enero 18:30', '18:30', '2027-01-08', '2026-01-08'],
    ['vier.', '9 de enero 18:30', '18:30', '2027-01-09', '2026-01-09'],
    ['lun.', '11 de enero 18:30', '18:30', '2026-01-11', '2027-01-11'],
    ['mar.', '12 de enero 18:30', '18:30', '2026-01-12', '2027-01-12'],
    ['sáb', '9 de enero 18:30', '18:30', '2026-01-09', '2027-01-09'],
    ['dom.', '10 de enero 18:30', '18:30', '2026-01-10', '2027-01-10'],
  ])('checks abbreviated weekday %s against the stated date', async (weekday, dateAndTime, time, wrongDate, date) => {
    const excerpt = `${weekday} ${dateAndTime}`
    const read = readHtml(`<h1>${facts.name}</h1><p>${excerpt}</p>`)
    expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(officialUrl, excerpt)], { ...facts, date, time }, read))).toEqual([])
    expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(officialUrl, excerpt)], { ...facts, date: wrongDate, time }, read)))
      .toEqual([`Official page excerpt states a weekday that does not match ${wrongDate}: ${officialUrl}`])
  })

  it.each([
    ['Jueves 17 de enero - Puerta 20 hs | Show 21 hs', '2027-01-17'],
    ['Jue. 17/01/2027 - Puerta 20 hs | Show 21 hs', '2027-01-17'],
  ])('rejects a doors pair whose weekday contradicts the candidate date: %s', async (excerpt, date) => {
    const read = readHtml(`<h1>${facts.name}</h1><p>${excerpt}</p>`)
    expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(officialUrl, excerpt)], { ...facts, date }, read)))
      .toEqual([`Official page excerpt states a weekday that does not match ${date}: ${officialUrl}`])
  })

  it('verifies the live Konex doors/show line with and without its ticket sector', async () => {
    const url = 'https://entradas.cckonex.org/event/dancing-mood'
    const candidate = { name: 'Dancing Mood', date: '2026-12-17', time: '20:30', doorsTime: '20:00', sites: officialSites({ website: url }) }
    const pair = 'Jueves 17 de diciembre - Puerta 20 hs | Show 20:30 hs'
    const line = `${pair}. Sector General`
    // Visible text and headings from the live Konex page captured on 2026-11-26, trimmed to the timing line and page chrome.
    const visible = `Ir a la compra de entradas\nDancing Mood\nSoporte\nIngresar / Registrarse\nUBICACIONES Y TARIFAS\n\n` +
      `BOTÓN DE ARREPENTIMIENTO\n Español English Português\n${line}`
    const read = readHtml('<h1>Dancing Mood</h1>')
    const render = async () => renderedPageRead(url, { url, title: '🐴 Dancing Mood',
      headings: ['Dancing Mood', 'Ingresar en tu cuenta', 'Crear cuenta'], hasH1: true,
      visible, ogTitle: null, siteName: null, fanzLinks: [], fanzJson: '', singleDate: '', challenge: false })
    for (const excerpt of [pair, line]) {
      for (const fields of [['date', 'time'], ['date', 'time', 'doors_time']] as const) {
        expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(url, excerpt, [...fields])], candidate, read, render)),
          `${fields.join(',')}: ${excerpt}`).toEqual([])
      }
    }
  })

  it('does not let a shortened quote remove the run marker from a doors pair', async () => {
    const excerpt = '20 de diciembre - Puerta 20 hs | Show 21 hs'
    expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(officialUrl, excerpt)], { ...facts, date: '2026-12-20' },
      readHtml(`<h1>${facts.name}</h1><p>Sábados hasta el ${excerpt}</p>`))))
      .toEqual([`Official page excerpt states the end of a run, not a performance date: ${officialUrl}`])
  })

  it.each(['Cada jueves', 'Todos los jueves', 'Desde el'])('does not treat %s as one occurrence on a doors/show line', async prefix => {
    const excerpt = '17 de diciembre - Puerta 20 hs | Show 21 hs'
    const read = readHtml(`<h1>${facts.name}</h1><p>${prefix} ${excerpt}</p>`)
    for (const quote of [excerpt, `${prefix} ${excerpt}`]) {
      expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(officialUrl, quote)], { ...facts, date: '2026-12-17' }, read)))
        .toEqual([`Official page excerpt states a run schedule, not a performance date: ${officialUrl}`])
    }
  })

  it('requires the page to state a different local doors date, including after midnight', async () => {
    const entry = 'Lunes 23 de noviembre a las 00:30'
    const read = readHtml(`<h1>${facts.name}</h1><p>${entry}</p>`)
    const at = { ...facts, date: '2026-11-24', doorsDate: '2026-11-23', doorsTime: '00:30' }
    const verify = (quote: string) => Effect.runPromise(verifyOfficialPagesEffect([evidence(officialUrl, quote, ['doors_time'])], at, read))
    expect(await verify(entry)).toEqual([])
    expect(await verify('a las 00:30')).toEqual([`Official page excerpt does not state the day 23: ${officialUrl}`])
  })

  it('rejects an ambiguous time list, even with a unit on both clocks', async () => {
    const excerpt = 'Lunes 23 de noviembre - 21 hs | 22 hs'
    expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(officialUrl, excerpt)], { ...facts, time: '22:00' },
      readHtml(`<h1>${facts.name}</h1><p>${excerpt}</p>`))))
      .toEqual([`Official page excerpt lists multiple dates or start times; cite the single occurrence's line: ${officialUrl}`])
  })

  it('reads "20 hs" after a weekday as a clock, so a range end never becomes the start', async () => {
    const excerpt = 'Todos los viernes 20 hs - 22 hs'
    const reasons = await Effect.runPromise(verifyOfficialPagesEffect([evidence(officialUrl, excerpt)], { ...facts, date: '2026-11-20', time: '22:00' },
      readHtml(`<h1>${facts.name}</h1><p>${excerpt}</p>`)))
    expect(reasons).not.toEqual([])
  })

  it('allows the date and either clock to be cited independently', async () => {
    const date = 'LUNES 23 NOVIEMBRE', time = 'a las 21', doors = 'Apertura de sala 20.30'
    const read = readHtml(`<h1>${facts.name}</h1><p>${date}</p><p>${time}</p><p>${doors}</p>`)
    expect(await Effect.runPromise(verifyOfficialPagesEffect([
      evidence(officialUrl, date, ['date']), evidence(officialUrl, time, ['time']), evidence(officialUrl, doors, ['doors_time']),
    ], { ...facts, doorsTime: '20:30' }, read))).toEqual([])
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

  it.each([
    ['Tus entradas para', 'Música en órbita - Sesión 1'],
    ['Entradas para', 'Un tren a la luna'],
    ['Comprá tus entradas para', 'María + Los Faros'],
  ])('verifies a checkout H1 starting with %s only for the exact show', async (prefix, name) => {
    const heading = `${prefix} ${name}`.replace('+', 'y')
    const html = (text: string) => `<title>Entradas para ${name} - Boletería Ficticia</title><h1>${text}</h1><p>${officialQuote}</p>`
    expect(await verifyShow(name, html(heading))).toEqual([])
    expect((await verifyShow(name, html(`${heading} - Segunda función`)))[0]).toContain('Official page does not name')
    expect((await verifyShow(name, html(`Abono: ${heading}`)))[0]).toContain('Official page does not name')
    expect((await verifyShow(name.split(' ').slice(1).join(' '), html(heading)))[0]).toContain('Official page does not name')
  })

  it('uses an exact event title with corroborated site branding when the lone H1 names the institution', async () => {
    const show = 'La habitación, el patio y la lluvia'
    const html = `<title>${show} - Centro de Escena - Universidad de Ejemplo</title>
      <meta property="og:site_name" content="Universidad de Ejemplo"><h1>Centro de Escena</h1><h2>${show}</h2><p>${officialQuote}</p>`
    expect(await verifyShow(show, html)).toEqual([])
    expect((await verifyShow('La habitación', html))[0]).toContain('Official page does not name')
    expect((await verifyShow(show, html.replace('<h1>Centro de Escena</h1>', '<h1>Otra obra</h1>')))[0]).toContain('H1: "Otra obra"')
    expect((await verifyShow(show, html.replace('property="og:site_name"', 'name="description"')))[0]).toContain('Official page does not name')
  })

  it('accepts a site suffix on the title or H1 only when corroborated', async () => {
    const show = 'Ritmos de papel'
    const site = 'Casa Ficticia - Sala Azul'
    const og = `<meta property="og:site_name" content="${site}">`
    const title = `<title>${show} - ${site}</title>`
    const schedule = `<p>${officialQuote}</p>`
    expect(await verifyShow(show, `${title}${og}${schedule}`)).toEqual([])
    expect(await verifyShow(show, `${og}<h1>${show} - ${site}</h1>${schedule}`)).toEqual([])
    expect(await verifyShow(show, `${title}<h1>${site}</h1>${schedule}`)).toEqual([])
    expect(await verifyShow(show, `${title}<h1>${site}</h1><h1>${show} - ${site}</h1>${schedule}`)).toEqual([])
    for (const html of [title, `<h1>${show} - ${site}</h1>`, `${title}<h1>${show} - ${site}</h1>`,
      `${og}<h1>${show} - Otra función - ${site}</h1>`]) {
      expect((await verifyShow(show, html + schedule))[0]).toContain('Official page does not name')
    }
  })

  it('ignores only a listed rating that is its own leading or trailing child of the identity H1', async () => {
    const show = '¡Órbita! Único show en Buenos Aires'
    const html = (heading: string) => `<h1>${heading}</h1><p>${officialQuote}</p>`
    expect(await verifyShow(show, html(`<span data-evt-title>${show}</span><span data-evt-age>ATP</span>`))).toEqual([])
    for (const rating of ['ATP', 'Apto todo público', '+13', '+16', '+18', 'SAM 13', 'SAM 16', 'SAM 18', 'R13', 'R16', 'R18']) {
      expect(await verifyShow(show, html(`<span>${rating}</span> ${show}`)), rating).toEqual([])
      expect(await verifyShow(show, html(`${show} <span>${rating}</span>`)), rating).toEqual([])
    }
    for (const heading of ['Otra obra <span>ATP</span>', `${show} <span>VIP</span>`, `${show} ATP`, `ATP ${show}`,
      `<span>${show} +18</span>`, `${show} <span>Clasificación ATP</span>`, '¡Órbita! <span>ATP</span> Único show en Buenos Aires']) {
      expect((await verifyShow(show, html(heading)))[0], heading).toContain('Official page does not name')
    }
    expect(await verifyShow(`${show} ATP`, html(`${show} ATP`))).toEqual([])
    expect((await verifyShow(show, `<title>${show} ATP</title><p>${officialQuote}</p>`))[0]).toContain('Official page does not name')
  })

  it('does not shorten a plain age-like title, including after browser rendering', async () => {
    const name = 'Impro'
    const heading = 'Impro +18'
    const reason = `Official page does not name "${name}" (H1: "${heading}"): ${officialUrl}`
    expect(await verifyShow(name, `<h1>${heading}</h1><p>${officialQuote}</p>`)).toEqual([reason])
    expect(await verifyShow(heading, `<h1>${heading}</h1><p>${officialQuote}</p>`)).toEqual([])
    const render = async () => renderedPageRead(officialUrl, { url: officialUrl, visible: `${heading}\n${officialQuote}`,
      title: '', headings: [heading], hasH1: true, ogTitle: null, siteName: null, fanzLinks: [], fanzJson: '', singleDate: '', challenge: false })
    expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(officialUrl, officialQuote)], { ...facts, name },
      readHtml(`<h1>${heading}</h1>`), render))).toEqual([reason])
  })

  it('uses a document title without head tags for the name, but never for the excerpt', async () => {
    const show = 'Sol y Luna'
    expect(await verifyShow(show, `<title>${show}</title><p>${officialQuote}</p>`)).toEqual([])
    expect(await verifyShow(show, `<html><title>${show}</title><body><p>${officialQuote}</p></body></html>`)).toEqual([])
    expect(await verifyShow(show, `<title>${officialQuote}</title><h1>${show}</h1>`)).toEqual([
      `Official page evidence must be an excerpt of the page's visible text: ${officialUrl}`,
    ])
  })

  it.each([
    ['La lluvia, el patio y el mar', 'La lluvia, el patio y el mar'],
    ['Fábulas + Sombras', 'Fabulas y sombras'],
  ])('uses an exact og:title on a branded page with only H2s: %s', async (name, ogTitle) => {
    const html = `<html><head><title>${name} - Centro de Escena - Universidad de Ejemplo</title>
      <meta property="og:title" content="${ogTitle}"></head>
      <body><h2>Centro de Escena</h2><h2>${name}</h2><p>${officialQuote}</p></body></html>`
    expect(await verifyShow(name, html)).toEqual([])
  })

  it('does not use a missing, unrelated, or partial og:title as a match', async () => {
    const name = 'Sol y Luna'
    const schedule = `<p>${officialQuote}</p>`
    for (const metadata of ['', '<meta property="og:title" content="Otra obra">',
      `<meta property="og:title" content="${name} - Segunda función">`]) {
      const html = `<title>${name} - Centro de Escena - Universidad de Ejemplo</title>${metadata}${schedule}`
      expect((await verifyShow(name, html))[0]).toContain('Official page does not name')
    }
    expect(await verifyShow(name, `<title>${name}</title><meta property="og:title" content="Otra obra">${schedule}`)).toEqual([])
    expect(await verifyShow(name, `<title>${name}</title><meta property="og:title" content="${officialQuote}"><h2>Programación</h2>`)).toEqual([
      `Official page evidence must be an excerpt of the page's visible text: ${officialUrl}`,
    ])
  })

  it('does not use og:title when any H1 exists, even if it is ignored for visible identity', async () => {
    const name = 'Sol y Luna'
    const metadata = `<meta property="og:title" content="${name}"><meta property="og:site_name" content="Centro de Escena">`
    for (const heading of ['<h1>Otra obra</h1>', '<h1 hidden>Otra obra</h1>', '<h1></h1>', '<h1>Centro de Escena</h1>']) {
      const html = `<title>Cartelera - Centro de Escena</title>${metadata}${heading}<p>${officialQuote}</p>`
      expect((await verifyShow(name, html))[0], heading).toContain('Official page does not name')
    }
  })

  it('uses rendered og:title only when the rendered document has no H1', async () => {
    const title = `${facts.name} - Centro de Escena - Universidad de Ejemplo`
    const verify = (hasH1: boolean, headings: string[]) => Effect.runPromise(verifyOfficialPagesEffect(
      [evidence(officialUrl, officialQuote)], facts, readHtml('<body></body>'), async () => renderedPageRead(officialUrl, {
        url: officialUrl, visible: officialQuote, title, headings, hasH1, ogTitle: facts.name, siteName: null,
        fanzLinks: [], fanzJson: '', singleDate: '', challenge: false,
      })))
    expect(await verify(false, [])).toEqual([])
    expect((await verify(true, ['Otra obra']))[0]).toContain('H1: "Otra obra"')
    expect((await verify(true, []))[0]).toContain('Official page does not name')
  })

  it('uses the next visible H1 after a corroborated site header, or the title when none remains', async () => {
    const header = `<header><h1>Bolsa Sintética</h1></header><p>${officialQuote}</p>`
    const title = '<title>Sol y Luna - Bolsa Sintética</title>'
    expect(await verifyShow('Sol + Luna', `${title}${header}`)).toEqual([])
    expect((await verifyShow('Sol + Luna', `${title}${header.replace('Bolsa Sintética', 'Bolsa Sintética Agenda')}`))[0]).toContain('H1: "Bolsa Sintética Agenda"')
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

  it('binds a structured calendar citation to its own show, day cell, and start', async () => {
    const url = 'https://teatro.example.org/calendario/?mes=11&a=2026'
    const entry = (name: string, time: string) => `<li><div class="calendar-hora">${time}hs.</div>
      <a href="/obra/sintetica/"><strong>${name}</strong></a></li>`
    const html = `<title>Agenda del Teatro</title><h1>Cartelera</h1><table><tr>
      <td id="li-2026-11-23"><ul>${entry(facts.name, '21:00')}${entry('Otra Obra', '22:00')}${entry('Tercera Obra', '21:00')}</ul></td>
      <td id="li-2026-11-24"><ul>${entry(facts.name, '20:00')}${entry('El 21 de Septiembre', '18:00')}</ul></td>
      <td id="li-2026-11-31"><ul>${entry(facts.name, '14:00')}</ul></td>
      <td id="li-2026-11-25" hidden><ul>${entry(facts.name, '14:00')}</ul></td>
      <td id="li-2026-11-26"><ul>${entry(facts.name, '25:00')}</ul></td></tr></table>
      <p>2026-11-23 22:00 | ${facts.name}</p><p>2026-11-23 21:00</p>`
    const verify = (excerpt: string, candidate: Partial<typeof facts> = {}, fields?: Array<'date' | 'time' | 'venue'>) => Effect.runPromise(
      verifyOfficialPagesEffect([evidence(url, excerpt, fields)], { ...facts, ...candidate }, readHtml(html)))
    expect(await verify(`2026-11-23 21:00 | ${facts.name}`)).toEqual([])
    expect(await verify(`2026-11-24 20:00 | ${facts.name}`, { date: '2026-11-24', time: '20:00' })).toEqual([])
    expect(await verify('2026-11-24 18:00 | El 21 de Septiembre', { name: 'El 21 de Septiembre', date: '2026-11-24', time: '18:00' })).toEqual([])
    for (const [excerpt, candidate] of [
      ['2026-11-23 21:00 | Tercera Obra', {}],
      ['2026-11-23 22:00 | Otra Obra', { time: '22:00' }],
      [`2026-11-23 22:00 | ${facts.name}`, { time: '22:00' }],
      [`2026-11-24 20:00 | ${facts.name}`, { time: '20:00' }],
      [`2026-11-24 21:00 | ${facts.name}`, { date: '2026-11-24' }],
      [`2026-11-23 21:00 | ${facts.name}`, { date: '2026-11-24' }],
      [`2026-11-31 14:00 | ${facts.name}`, { date: '2026-11-31', time: '14:00' }],
      [`2026-11-25 14:00 | ${facts.name}`, { date: '2026-11-25', time: '14:00' }],
      [`2026-11-26 25:00 | ${facts.name}`, { date: '2026-11-26', time: '25:00' }],
      ['2026-11-23 21:00', {}],
    ] as const) expect(await verify(excerpt, candidate), excerpt).not.toEqual([])
    expect(await verify(`2026-11-23 21:00 | ${facts.name}`, {}, ['venue'])).not.toEqual([])
  })

  it.each(['SUSPENDIDA', 'Cancelada', 'Réprogramadas', 'Se suspende la función', 'Se reprograma', 'Cancelación',
    'Suspensión de la función', 'POSTERGADA', 'Se posterga la función', 'Función pospuesta', 'Se pospone la función'])('does not verify a calendar entry marked %s', async status => {
    const entry = (name: string, badge: string) => `<li><div class="calendar-hora">21:00 hs</div>
      <a href="/obra/sintetica/">${name}</a><span>${badge}</span></li>`
    const read = readHtml(`<h1>${facts.name}</h1><p>2026-11-23 21:00 | ${facts.name}</p>
      <table><tr><td id="li-2026-11-23"><ul>${entry(facts.name, status)}${entry('Otra obra', 'AGOTADA')}</ul></td></tr></table>`)
    const verify = (name: string) => Effect.runPromise(verifyOfficialPagesEffect(
      [evidence(officialUrl, `2026-11-23 21:00 | ${name}`)], { ...facts, name }, read))
    expect(await verify(facts.name)).not.toEqual([])
    expect(await verify('Otra obra')).toEqual([])
  })

  it('asks for the calendar start when the candidate omits it or has a different time', async () => {
    const read = readHtml(`<table><tr><td id="li-2026-11-23"><ul><li><div class="calendar-hora">21:00 hs</div>
      <a href="/obra/sintetica/">${facts.name}</a></li></ul></td></tr></table>`)
    for (const time of [null, '22:00']) {
      expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence(officialUrl, `2026-11-23 21:00 | ${facts.name}`, ['date'])],
        { ...facts, time }, read))).toEqual([`Official page calendar performance starts at 21:00; set the candidate's start time to match: ${officialUrl}`])
    }
  })

  it.each(['Open Mic', 'Abre el telón', 'Apertura', 'Puertas adentro'])('treats doors words as title text only in a structured calendar: %s', async name => {
    const excerpt = `2026-11-23 21:00 | ${name}`
    const html = `<table><tr><td id="li-2026-11-23"><ul><li><div class="calendar-hora">21:00 hs</div>
      <a href="/obra/sintetica/">${name}</a></li></ul></td></tr></table>`
    const verify = (html: string) => Effect.runPromise(verifyOfficialPagesEffect([evidence(officialUrl, excerpt)], { ...facts, name }, readHtml(html)))
    expect(await verify(html)).toEqual([])
    expect(await verify(`<h1>${name}</h1><p>${excerpt}</p>`)).toEqual([])
  })

  it('checks weekdays explicitly stated in a calendar day cell or performance row, not in the title', async () => {
    const name = 'Domingo de fiesta'
    const verify = (cellLabel: string, entryLabel: string) => Effect.runPromise(verifyOfficialPagesEffect(
      [evidence(officialUrl, `2026-11-23 21:00 | ${name}`)], { ...facts, name },
      readHtml(`<table><tr><td id="li-2026-11-23"><span>${cellLabel}</span><ul><li><span>${entryLabel}</span>
        <div class="calendar-hora">21:00 hs</div><a href="/obra/domingo/">${name}</a></li></ul></td></tr></table>`)))
    expect(await verify('Lunes 23', 'Lun.')).toEqual([])
    expect(await verify('Jueves 23', 'Lunes')).not.toEqual([])
    expect(await verify('Lunes 23', 'Domingo')).not.toEqual([])
  })

  it('binds a structured calendar to the stored venue host after redirects, not a sibling host', async () => {
    const venueWebsite = 'https://www.sala-a.wordpress.com'
    const ownUrl = 'https://sala-a.wordpress.com/calendario'
    const siblingUrl = 'https://sala-b.wordpress.com/calendario'
    const otherUrl = 'https://tour.example.net/calendario'
    const allowed = officialSites({ website: venueWebsite, captions: [`Gira: ${otherUrl}`] })
    const html = `<h1>${facts.name}</h1><p>2026-11-23 21:00 | ${facts.name}</p>
      <table><tr><td id="li-2026-11-23"><ul><li><div class="calendar-hora">21:00 hs</div>
      <a href="/obra/sintetica/">${facts.name}</a></li></ul></td></tr></table>`
    const verify = (requested: string, final: string, venueWebsite?: string) => {
      const fetcher: typeof fetch = async url => String(url) === final ? page(html)
        : new Response(null, { status: 302, headers: { location: final } })
      return Effect.runPromise(verifyOfficialPagesEffect([evidence(requested, `2026-11-23 21:00 | ${facts.name}`)],
        { ...facts, sites: allowed, venueWebsite }, (url, sites) => readOfficialPage(url, sites, fetcher)))
    }
    expect(await verify(ownUrl, ownUrl, venueWebsite)).toEqual([])
    expect(await verify(otherUrl, ownUrl, venueWebsite)).toEqual([])
    expect(await verify(siblingUrl, ownUrl, venueWebsite)).toEqual([])
    for (const [requested, final, website] of [[otherUrl, otherUrl, venueWebsite], [ownUrl, otherUrl, venueWebsite],
      [siblingUrl, siblingUrl, venueWebsite], [ownUrl, siblingUrl, venueWebsite], [ownUrl, ownUrl, undefined]] as const) {
      expect(await verify(requested, final, website)).toEqual([`Official page calendar evidence must be on the selected venue's stored website: ${requested}`])
    }
  })

  it('does not apply calendar excerpt rules to ordinary pages with a text lookalike', async () => {
    const excerpt = '2026-11-23 21:00 | El 21 de Septiembre'
    const reasons = await Effect.runPromise(verifyOfficialPagesEffect([evidence(officialUrl, excerpt)], { ...facts, name: 'El 21 de Septiembre' },
      readHtml(`<h1>El 21 de Septiembre</h1><p>${excerpt}</p>`)))
    expect(reasons[0]).toContain('lists multiple dates or start times')
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
      evidence('https://teatro.example.org/obra', 'LUNES 23 DE NOVIEMBRE 21:00'), // hidden on the page
      evidence('https://teatro.example.org/obra', 'LUNES, 23 DE NOVIEMBRE 21:00'),
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
    return renderedPageRead(url, { url, title: title ?? '', visible, headings: h1 ? [h1] : [], hasH1: h1 !== null, ogTitle: null, siteName: null,
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
      selected: { date: '2026-11-28', time: '22:00', lines: [excerpt], title: facts.name } })
    expect(JSON.stringify(read)).not.toMatch(/sáb 21|OCULTO|OTRA OBRA/)
    const early = (async () => page(fixture.replaceAll('2026-11-29T0', '2026-12-05T0')
      .replace(excerpt, 'Empieza el vie 04 de dic 2026 22:00 - 23:15 hs'))) as typeof fetch
    expect(await readOfficialPage(url, allowed, early)).toMatchObject({
      selected: { date: '2026-12-04', lines: ['Empieza el vie 04 de dic 2026 22:00 - 23:15 hs'] },
    })
    const verify = (time: string, date = '2026-11-28', quote = excerpt, fields?: Array<'date' | 'time' | 'venue'>) => Effect.runPromise(
      verifyOfficialPagesEffect([evidence(url, quote, fields)], { ...facts, date, time, sites: allowed },
        (target, sites) => readOfficialPage(target, sites, fetcher), camarinRender(fixture)))
    expect(await verify('22:00')).toEqual([])
    expect(await verify('23:15')).toEqual([`Official page excerpt does not state the time 23:15: ${url}`])
    expect(await verify('22:15')).toEqual([`Official page excerpt does not state the time 22:15: ${url}`])
    expect(await verify('23:15', '2026-11-28', '23:15 hs', ['time']))
      .toEqual([`Official page excerpt does not state the time 23:15: ${url}`])
    expect(await verify('22:00', '2026-12-28')).toEqual([`Official page excerpt does not state the selected performance date 2026-12-28: ${url}`])
    expect(await verify('22:00', '2026-11-21', excerpt, ['time']))
      .toEqual([`Official page excerpt does not state the selected performance date 2026-11-21: ${url}`])
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

  it.each([
    ['Jazz en la terraza', '2026-11-23', 'Empieza el lun. 23 de nov 2026 a las 18:00 - 20:00'],
    ['Un piano de papel', '2026-12-04', 'Empieza el vie. 4 de dic 2026 a las 18:00 - 20:00'],
  ])('verifies the rendered Fanz picker with a weekday period and a las for %s', async (name, date, line) => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-20T12:00:00Z'))
    const slug = '42-synthetic-show'
    const url = `https://teatro.example.org/event/${slug}?eventDateId=17`
    const html = camarinPage('17', name).replace('"eventId":"42"', `"eventId":"${slug}"`)
      .replace(CAMARIN_EXCERPT, line)
      .replace('2026-11-29T01:00:00.000Z', `${date}T21:00:00.000Z`)
      .replace('2026-11-29T02:15:00.000Z', `${date}T23:00:00.000Z`)
    const visible = (quote: string) => `<h1>${name}</h1><p>${quote}</p>`
    const render = (quote: string, json = fanzJson(html)) => async () => renderedPageRead(url, {
      url, title: name, headings: [name], hasH1: true, ogTitle: null, visible: visibleText(visible(quote)), siteName: null,
      fanzLinks: ['https://fanz.com.ar'], fanzJson: json, singleDate: '', challenge: false,
    })
    const verify = (quote: string, renderer?: Parameters<typeof verifyOfficialPagesEffect>[3]) => Effect.runPromise(verifyOfficialPagesEffect(
      [evidence(url, quote)], { ...facts, name, date, time: '18:00' }, readHtml(html), renderer))
    const missing = [`Official page date or time evidence must quote the selected future performance: ${url}`]
    const invalid = [`Official page could not verify the selected future Fanz performance: ${url}`]
    expect(await verify(line)).toEqual(missing)
    expect(await verify(line, render(line))).toEqual([])
    const ordinary = line.replace('Empieza el ', '') + ' en la sala'
    expect(await verify(ordinary, render(ordinary))).toEqual(missing)
    expect(await verify(line, render(line.replace('20:00', '20:30')))).toEqual(missing)
    expect(await verify(line, render(line, fanzJson(html).replace('"Dates":', '"changedDates":')))).toEqual(invalid)
    clock.mockReturnValue(Date.parse(`${date}T21:00:00Z`))
    expect(await verify(line, render(line))).toEqual(invalid)
  })

  it('accepts a separate entry line on a rendered selected performance without promoting the picker clock', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-20T12:00:00Z'))
    const entry = 'Abrimos las puertas a las 21h'
    const html = camarinPage('17', facts.name, `<p>${entry}</p>`)
    const verify = (rendered = html, date = '2026-11-28', citations = [
      evidence(CAMARIN_URL, CAMARIN_EXCERPT, ['date']), evidence(CAMARIN_URL, entry, ['doors_time']),
    ]) => Effect.runPromise(verifyOfficialPagesEffect(citations,
      { ...facts, date, time: null, doorsTime: '21:00', sites: CAMARIN_SITES }, readHtml(html), camarinRender(rendered)))
    expect(await verify()).toEqual([])
    // The doors excerpt can use a date from the post instead, but cannot bypass a URL's selection.
    const doors = [evidence(CAMARIN_URL, entry, ['doors_time'])]
    expect(await verify(html, '2026-11-28', doors)).toEqual([])
    expect(await verify(html.replace(CAMARIN_EXCERPT, ''), '2026-11-28', doors)).toEqual([
      `Official page date or time evidence must quote the selected future performance: ${CAMARIN_URL}`,
    ])
    expect(await verify(html, '2026-11-29', doors)).toEqual([
      `Official page excerpt does not state the selected performance date 2026-11-29: ${CAMARIN_URL}`,
    ])
    expect(await verify(html.replace(`<p>${entry}</p>`, `<p hidden>${entry}</p>`))).toEqual([
      `Official page evidence must be an excerpt of the page's visible text: ${CAMARIN_URL}`,
    ])
  })

  it('binds the Fanz date to the picker and lets a separate visible line supply the start', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-20T12:00:00Z'))
    const entry = 'Apertura de sala 22 hs'
    const show = 'Después de cenar, música a las 23'
    const html = camarinPage('17', facts.name, `<p>${entry}</p><p>${show}</p>`)
    const verify = (time: string | null, citations: ReturnType<typeof evidence>[]) => Effect.runPromise(verifyOfficialPagesEffect(
      citations, { ...facts, date: '2026-11-28', time, doorsTime: '22:00', sites: CAMARIN_SITES }, readHtml(html), camarinRender(html)))
    const date = evidence(CAMARIN_URL, CAMARIN_EXCERPT, ['date'])
    const doors = evidence(CAMARIN_URL, entry, ['doors_time'])
    expect(await verify(null, [date, doors])).toEqual([])
    expect(await verify('23:00', [date, doors, evidence(CAMARIN_URL, show, ['time'])])).toEqual([])
    expect(await verify('23:00', [doors, evidence(CAMARIN_URL, show, ['date', 'time'])]))
      .toEqual([`Official page date or time evidence must quote the selected future performance: ${CAMARIN_URL}`])
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
        url, visible: `${facts.name}\n${line}`, title: facts.name, headings: [h1], hasH1: true, ogTitle: null, siteName: null, fanzLinks: ['https://fanz.com.ar'],
        fanzJson: fanzJson(raw), singleDate: shown, challenge: false,
      })))
    const missing = [`Official page date or time evidence must quote the selected future performance: ${url}`]
    expect(await verify(line)).toEqual([])
    expect(await verify(line, line, '22:00', facts.name, '2037-11-28')) // Same weekday, but still the wrong year.
      .toEqual([`Official page excerpt does not state the selected performance date 2037-11-28: ${url}`])
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
        url, visible: CAMARIN_EXCERPT, title: facts.name, headings: [facts.name], hasH1: true, ogTitle: null, siteName: null, fanzLinks: [],
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
    expect(await camarinRead(camarinPage())(CAMARIN_URL, CAMARIN_SITES)).toMatchObject({ selected: { lines: [CAMARIN_EXCERPT] } })
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
