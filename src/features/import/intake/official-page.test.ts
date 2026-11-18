import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import { normalizePageText, officialSites, publicPageUrl, readOfficialPage, siteOf, verifyOfficialPagesEffect, visibleText } from './official-page.ts'

const page = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, ...init })
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
    ], facts, async () => visibleText(SHOWTIMES)))
    expect(reasons).toEqual([])
    expect(normalizePageText(' Á  b\u00a0C ')).toBe('a b c')
    expect(normalizePageText(visibleText('<p><span>LUNES</span><span>23</span></p>'))).toBe('lunes 23')
  })

  it('keeps token boundaries: "sábado 2 21:00" is not "sábado 22 1:00" or "12 21:00"', async () => {
    const page = async () => visibleText('<h1>Forever Sintético</h1><p>sábado 22 1:00</p><p>viernes 12 21:00</p>')
    const day2 = { ...facts, date: '2026-11-02' }
    for (const excerpt of ['sábado 2 21:00', '2 21:00 y más']) {
      expect(await Effect.runPromise(verifyOfficialPagesEffect([evidence('https://teatro.example.org/obra', excerpt)], day2, page)))
        .toEqual(["Official page evidence must be an excerpt of the page's visible text: https://teatro.example.org/obra"])
    }
  })

  it('requires the show\'s name on the page and the cited date and time in the excerpt', async () => {
    const run = (excerpt: string, fields?: Array<'date' | 'time'>, html = SHOWTIMES, at = facts) =>
      Effect.runPromise(verifyOfficialPagesEffect([evidence('https://teatro.example.org/obra', excerpt, fields)], at, async () => visibleText(html)))
    expect(await run('LUNES 23 NOVIEMBRE 21:00', undefined, SHOWTIMES.replace(/Forever&nbsp;Sint&eacute;tico/, 'Otra obra')))
      .toEqual(['Official page does not name "Forever Sintético": https://teatro.example.org/obra'])
    expect(await run('NOVIEMBRE 2026 en cartel', ['date'], '<h1>Forever Sintético</h1><p>NOVIEMBRE 2026 en cartel</p>'))
      .toEqual(['Official page excerpt does not state the day 23: https://teatro.example.org/obra'])
    expect(await run('LUNES 23 NOVIEMBRE 21:00', undefined, SHOWTIMES, { ...facts, time: '21:30' }))
      .toEqual(['Official page excerpt does not state the time 21:30: https://teatro.example.org/obra'])
    // Leading zeros and 12-hour times with p.m. count.
    expect(await run('lunes 02/11 9 p.m.', undefined, '<h1>Forever Sintético</h1><p>Lunes 02/11 9 p.m.</p>', { ...facts, date: '2026-11-02' })).toEqual([])
  })

  it('rejects an excerpt the page lacks, hidden text, a failed read, a private address, and a too-short excerpt', async () => {
    let reads = 0
    const reasons = await Effect.runPromise(verifyOfficialPagesEffect([
      evidence('https://teatro.example.org/obra', 'MARTES 23 NOVIEMBRE 21:00'), // hidden on the page
      evidence('https://teatro.example.org/obra', 'LUNES 23 DICIEMBRE 21:00'),
      evidence('https://down.example.org/obra', 'LUNES 23 NOVIEMBRE', ['date']),
      evidence('https://192.168.0.2/obra', 'LUNES 23 NOVIEMBRE', ['date']),
      evidence('https://teatro.example.org/obra', 'el 23', ['date']),
    ], facts, async url => { reads++; if (url.includes('down')) throw new Error('answered 503'); return visibleText(SHOWTIMES) }))
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
    expect(await readOfficialPage('https://teatro.example.org/old', sites, fetcher)).toContain('LUNES 23 NOVIEMBRE')
    expect(requests.map(request => request.url)).toEqual(['https://teatro.example.org/old', 'https://teatro.example.org/obra'])
    expect(requests[0].init).toMatchObject({ redirect: 'manual' })
    expect(Object.keys(requests[0].init!.headers as object).map(key => key.toLowerCase())).not.toContain('cookie')
    expect(requests[0].init!.credentials).toBeUndefined()
    await expect(readOfficialPage('https://teatro.example.org/sneaky', sites, fetcher)).rejects.toThrow('not a public HTTPS page')
  })

  it('counts only the venue\'s site, sites cited posts link to, the post-backed ticket site, and known ticket sellers', () => {
    const allowed = officialSites({ website: 'teatropicadero.com.ar', ticketUrl: 'https://entradas.sala.com.ar/x',
      captions: ['Info en www.organizador.org.ar/obra y https://linktr.ee/sala, también https://www.instagram.com/sala'] })
    expect(siteOf('www.teatropicadero.com.ar')).toBe('teatropicadero.com.ar')
    for (const site of ['teatropicadero.com.ar', 'sala.com.ar', 'organizador.org.ar', 'plateanet.com', 'alternativateatral.com']) expect(allowed.has(site), site).toBe(true)
    for (const site of ['linktr.ee', 'instagram.com', 'example.org']) expect(allowed.has(site), site).toBe(false)
    expect(officialSites({ website: 'https://www.facebook.com/sala' }).has('facebook.com')).toBe(false)
  })

  it('refuses a page or a redirect off the allowed sites, and social or wrapper hosts even when a venue links them', async () => {
    const reasons = await Effect.runPromise(verifyOfficialPagesEffect([
      evidence('https://agenda.example.net/forever', 'LUNES 23 NOVIEMBRE 21:00'),
      evidence('https://teatro-example-org.translate.goog/obra', 'LUNES 23 NOVIEMBRE 21:00'),
    ], { ...facts, sites: new Set([...sites, 'translate.goog']) }, async () => visibleText(SHOWTIMES)))
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
    // A completed boundary reveals its segment too, in either quote style and with spaces.
    expect(visibleText(STREAMED.replace(`$RS("S:2","P:2")`, `$RC( 'B:0' , 'S:2' )`))).toContain('19:00 - 27/11/2026')
  })

  it('keeps a streaming segment hidden when the page never reveals it', async () => {
    const unrevealed = STREAMED.replace(`<script>$RS("S:2","P:2")</script>`, `<script>$RC("B:1","S:1")</script>`)
    expect(visibleText(unrevealed)).not.toContain('27/11/2026')
    expect(await kiki(unrevealed)).toEqual(["Official page evidence must be an excerpt of the page's visible text: https://www.revamos.com/eventos/kiki-ball"])
  })

  it('names a bot check or an empty page as unreadable', async () => {
    // Trimmed from plateanet.com (2026-11-18): Incapsula answers automated readers with this stub.
    const incapsula = '<html><head><META NAME="robots" CONTENT="noindex,nofollow"><script src="/_Incapsula_Resource?SWJIYLWA=0"></script><body></body></html>'
    const cloudflare = '<html><head><title>Just a moment...</title></head><body><p>Verificando 23 noviembre</p><script>window._cf_chl_opt = {}</script></body></html>'
    for (const html of [incapsula, cloudflare, '<html><body> </body></html>']) {
      const reasons = await Effect.runPromise(verifyOfficialPagesEffect([evidence('https://www.plateanet.com/obra/1', 'LUNES 23 NOVIEMBRE 21:00')],
        facts, (url, allowed) => readOfficialPage(url, allowed, (async () => page(html)) as unknown as typeof fetch)))
      expect(reasons).toEqual(['Official page could not be read: https://www.plateanet.com/obra/1 (the site shows a bot check or an empty page to automated readers; cite another official page)'])
    }
  })

  it('reads a real listing page that carries an Incapsula script', async () => {
    const listing = SHOWTIMES.replace('</head>', '<script src="/_Incapsula_Resource?SWJIYLWA=0"></script></head>')
      .replace('</body>', '<p>Funciones de jueves a domingo. Duración: 80 minutos. Apto para todo público. Entradas en boletería y online. Elenco, dirección y equipo técnico sintéticos. Descuentos para jubilados y estudiantes con credencial.</p></body>')
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
