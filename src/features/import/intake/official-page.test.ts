import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import { normalizePageText, publicPageUrl, readOfficialPage, verifyOfficialPagesEffect, visibleText } from './official-page.ts'

const page = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, ...init })
const SHOWTIMES = `<html><head><title>Sala Sintética</title><script>var s = "LUNES 1 ENERO 09:00"</script></head><body>
  <div class="sp-funcion-fecha">
      LUNES 23 NOVIEMBRE
  </div>
  <div class="sp-funcion-hora">21:00</div>
  <p hidden>MARTES 24 NOVIEMBRE 22:00</p><p style="display: none">MIÉRCOLES 25 NOVIEMBRE</p>
  <p>Teatro&nbsp;Sint&eacute;tico, Pasaje Ficticio 1234</p>
</body></html>`
const evidence = (url: string, excerpt: string) => ({ kind: 'official_page' as const, url, fields: ['date' as const, 'time' as const], excerpt })

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

  it('matches an excerpt across markup whitespace, case, and accents', async () => {
    const reasons = await Effect.runPromise(verifyOfficialPagesEffect([
      evidence('https://teatro.example.org/obra', 'Lunes 23 noviembre 21:00'),
      evidence('https://teatro.example.org/obra', 'teatro sintetico, pasaje ficticio 1234'),
    ], async () => visibleText(SHOWTIMES)))
    expect(reasons).toEqual([])
    expect(normalizePageText(' Á  b\u00a0C ')).toBe('abc')
  })

  it('rejects an excerpt the page lacks, hidden text, a failed read, a private address, and a too-short excerpt', async () => {
    let reads = 0
    const reasons = await Effect.runPromise(verifyOfficialPagesEffect([
      evidence('https://teatro.example.org/obra', 'MARTES 24 NOVIEMBRE 22:00'),
      evidence('https://teatro.example.org/obra', 'LUNES 30 NOVIEMBRE 20:00'),
      evidence('https://down.example.org/obra', 'LUNES 23 NOVIEMBRE'),
      evidence('https://192.168.0.2/obra', 'LUNES 23 NOVIEMBRE'),
      evidence('https://teatro.example.org/obra', '21:00'),
    ], async url => { reads++; if (url.includes('down')) throw new Error('answered 503'); return visibleText(SHOWTIMES) }))
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
    expect(await readOfficialPage('https://teatro.example.org/old', fetcher)).toContain('LUNES 23 NOVIEMBRE')
    expect(requests.map(request => request.url)).toEqual(['https://teatro.example.org/old', 'https://teatro.example.org/obra'])
    expect(requests[0].init).toMatchObject({ redirect: 'manual' })
    expect(Object.keys(requests[0].init!.headers as object).map(key => key.toLowerCase())).not.toContain('cookie')
    expect(requests[0].init!.credentials).toBeUndefined()
    await expect(readOfficialPage('https://teatro.example.org/sneaky', fetcher)).rejects.toThrow('not a public HTTPS page')
  })

  it('refuses non-HTML bodies, error statuses, and oversized pages', async () => {
    const answer = (response: Response) => (async () => response) as unknown as typeof fetch
    await expect(readOfficialPage('https://a.example.org/', answer(page('x', { headers: { 'content-type': 'application/pdf' } })))).rejects.toThrow('not an HTML page')
    await expect(readOfficialPage('https://a.example.org/', answer(page('x', { status: 404 })))).rejects.toThrow('answered 404')
    await expect(readOfficialPage('https://a.example.org/', answer(page('x'.repeat(2_097_153))))).rejects.toThrow('page exceeds 2 MB')
  })
})
