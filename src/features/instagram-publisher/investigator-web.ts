import { Resolver } from 'node:dns/promises'
import { get } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { load } from 'cheerio/slim'

const privateAddresses = new BlockList()
for (const [address, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]] as const) privateAddresses.addSubnet(address, bits)

export function publicResearchUrl(raw: string) {
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.port || url.username || url.password || raw.length > 1500 || isIP(url.hostname) ||
    !/^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/u.test(url.hostname) || /\.(local|localhost|internal|home\.arpa)$/u.test(url.hostname)) {
    throw new Error('Use a public HTTPS website.')
  }
  return url
}

/** Uncredentialed GET only. Pin a public IPv4 address for each hop. */
async function page(raw: string, hops = 0): Promise<{ url: string; html: string }> {
  const url = publicResearchUrl(raw)
  const addresses = await new Resolver({ timeout: 1500, tries: 1 }).resolve4(url.hostname)
  const address = addresses[0]
  if (!address || addresses.some(ip => privateAddresses.check(ip))) throw new Error('That host did not resolve to public IPv4 addresses.')
  const response = await new Promise<{ redirect?: string; html?: string }>((resolve, reject) => {
    const request = get(url, { agent: false, family: 4, lookup: (_host, _options, cb) => cb(null, address, 4),
      signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': 'BA Eventos publisher research', Accept: 'text/html,text/plain' } }, res => {
      res.on('error', reject)
      const code = res.statusCode ?? 0
      if (code >= 300 && code < 400 && res.headers.location && hops < 2) {
        try { resolve({ redirect: new URL(res.headers.location, url).href }) } catch { reject(new Error('Invalid redirect.')) }
        res.destroy()
        return
      }
      if (code !== 200 || !/^(text\/(html|plain)|application\/xhtml\+xml)\b/iu.test(res.headers['content-type'] ?? '')) {
        reject(new Error(`Could not read the public text page (HTTP ${code}).`)); res.destroy(); return
      }
      let body = ''
      res.setEncoding('utf8').on('data', (part: string) => {
        body += part
        if (body.length >= 500_000) { resolve({ html: body.slice(0, 500_000) }); res.destroy() }
      }).on('end', () => resolve({ html: body }))
    })
    request.on('error', reject)
  })
  return response.redirect ? page(response.redirect, hops + 1) : { url: url.href, html: response.html ?? '' }
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

export async function researchSearch(query: string) {
  const { html } = await page(`https://html.duckduckgo.com/html/?${new URLSearchParams({ q: query })}`)
  const $ = load(html)
  return $('.result__a').slice(0, 8).map((_, el) => {
    try {
      const link = new URL($(el).attr('href')!, 'https://duckduckgo.com')
      return { title: $(el).text().trim().slice(0, 250), url: publicResearchUrl(link.searchParams.get('uddg') ?? link.href).href }
    } catch { return null }
  }).get()
}
