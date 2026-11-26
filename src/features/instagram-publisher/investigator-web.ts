import { Resolver } from 'node:dns/promises'
import { request } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { load } from 'cheerio/slim'
import { InvestigatorToolError } from './investigator-error.ts'

const privateAddresses = new BlockList()
for (const [address, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]] as const) privateAddresses.addSubnet(address, bits)

export function publicResearchUrl(raw: string) {
  const url = URL.parse(raw)
  if (!url || url.protocol !== 'https:' || url.port || url.username || url.password || raw.length > 1500 || isIP(url.hostname) ||
    !/^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/u.test(url.hostname) || /\.(local|localhost|internal|home\.arpa)$/u.test(url.hostname)) {
    throw new InvestigatorToolError('Use a public HTTPS website.')
  }
  return url
}

/** Uncredentialed requests only. Pin a public IPv4 address for each hop. */
async function page(raw: string, form?: string, hops = 0): Promise<{ url: string; html: string }> {
  const url = publicResearchUrl(raw)
  const addresses = await new Resolver({ timeout: 1500, tries: 1 }).resolve4(url.hostname).catch(() => [])
  const address = addresses[0]
  if (!address || addresses.some(ip => privateAddresses.check(ip))) throw new InvestigatorToolError('That host did not resolve to public IPv4 addresses.')
  const headers = { 'User-Agent': 'BA Eventos publisher research', Accept: 'text/html,text/plain',
    ...(form === undefined ? {} : { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(form) }) }
  const response = await new Promise<{ redirect?: string; html?: string }>((resolve, reject) => {
    const failed = () => reject(new InvestigatorToolError('Could not connect to the public website.'))
    const req = request(url, { method: form === undefined ? 'GET' : 'POST', agent: false, family: 4,
      lookup: (_host, _options, cb) => cb(null, address, 4), signal: AbortSignal.timeout(10_000), headers }, res => {
      res.on('error', failed)
      const code = res.statusCode ?? 0
      // Never resend the search form on a redirect. Any non-200 POST response triggers the lite fallback.
      if (form === undefined && code >= 300 && code < 400 && res.headers.location && hops < 2) {
        try { resolve({ redirect: new URL(res.headers.location, url).href }) } catch { reject(new InvestigatorToolError('Invalid redirect.')) }
        res.destroy()
        return
      }
      if (code !== 200 || !/^(text\/(html|plain)|application\/xhtml\+xml)\b/iu.test(res.headers['content-type'] ?? '')) {
        reject(new InvestigatorToolError(`Could not read the public text page (HTTP ${code}).`)); res.destroy(); return
      }
      let body = ''
      res.setEncoding('utf8').on('data', (part: string) => {
        body += part
        if (body.length >= 500_000) { resolve({ html: body.slice(0, 500_000) }); res.destroy() }
      }).on('end', () => resolve({ html: body }))
    })
    req.on('error', failed)
    req.end(form)
  })
  return response.redirect ? page(response.redirect, undefined, hops + 1) : { url: url.href, html: response.html ?? '' }
}

export async function researchPage(url: string) {
  const { url: finalUrl, html } = await page(url)
  const $ = load(html)
  $('script, style, noscript, svg').remove()
  const links = $('a[href]').slice(0, 50).map((_, el) => {
    try { return publicResearchUrl(new URL($(el).attr('href')!, finalUrl).href).href } catch { return null }
  }).get()
  return { url: finalUrl, title: $('title').text().trim(), text: $('body').text().replace(/\s+/gu, ' ').trim().slice(0, 18_000), links }
}

function searchLinks({ html, url: baseUrl }: Awaited<ReturnType<typeof page>>, selector: string) {
  const $ = load(html)
  return $(selector).map((_, el) => {
    try {
      const link = new URL($(el).attr('href')!, baseUrl)
      const redirected = (link.hostname === 'duckduckgo.com' || link.hostname.endsWith('.duckduckgo.com')) && link.pathname === '/l/'
        ? link.searchParams.get('uddg') : null
      return { title: $(el).text().trim().slice(0, 250), url: publicResearchUrl(redirected ?? link.href).href }
    } catch { return null }
  }).get().slice(0, 8)
}

async function searchOnce(query: string) {
  const form = new URLSearchParams({ q: query }).toString()
  const html = await page('https://html.duckduckgo.com/html/', form).catch(() => null)
  const results = html && searchLinks(html, 'a.result__a[href]')
  if (results?.length) return results

  const lite = await page(`https://lite.duckduckgo.com/lite/?${form}`).catch(() => null)
  // Keep an empty result set if HTML was readable. Only two failed requests mean search is unavailable.
  return lite ? searchLinks(lite, 'a.result-link[href]') : results
}

export async function researchSearch(query: string) {
  let results = await searchOnce(query)
  if (results === null) {
    const unquoted = query.replace(/["“”„‟]/gu, '')
    const keywords = unquoted.replace(/\s+/gu, ' ').trim()
    if (unquoted !== query && keywords) results = await searchOnce(keywords)
  }
  if (results === null) throw new InvestigatorToolError('Web search is unavailable right now; use research on a known URL instead.')
  return results
}
