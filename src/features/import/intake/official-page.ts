/**
 * Official-page evidence: the intake fetches the venue's, organizer's or ticket seller's page itself and accepts an
 * excerpt only when the page's visible text contains it. It runs where preview and commit run (the intake API Worker,
 * or the CLI in Supabase mode), never on the operator's word.
 */
import { load } from 'cheerio/slim'
import { Effect } from 'effect'
import { isOfficialPage, validPublicUrl, type Evidence } from './schema.ts'

const MAX_BYTES = 2_097_152
const TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 3
const MIN_EXCERPT = 8

/** Public HTTPS host names only: no IP literals, no single-label or local names. */
export function publicPageUrl(value: string): boolean {
  if (!validPublicUrl(value)) return false
  const host = new URL(value).hostname.toLowerCase()
  return !host.startsWith('[') && !/^[\d.]+$/.test(host) && !/(^|\.)(local|localhost|internal|lan|home|arpa)$/.test(host)
}

/** Accent-, case- and whitespace-insensitive: the page's markup splits and spaces text in ways the reader never sees. */
export const normalizePageText = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[\s\u00a0]+/gu, '')

export function visibleText(html: string): string {
  const $ = load(html)
  $('head, script, style, noscript, template, svg, iframe, [hidden], [aria-hidden="true"]').remove()
  $('[style]').filter((_, element) => /display\s*:\s*none|visibility\s*:\s*hidden/i.test($(element).attr('style') ?? '')).remove()
  return $.root().text()
}

/** GET with no cookies or credentials, manual redirects re-checked hop by hop, a time limit and a size limit. */
export async function readOfficialPage(url: string, fetcher: typeof fetch = fetch): Promise<string> {
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  let current = url
  for (let hop = 0; ; hop++) {
    if (!publicPageUrl(current)) throw new Error('not a public HTTPS page')
    const response = await fetcher(current, { redirect: 'manual', signal,
      headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5', 'User-Agent': 'BA Eventos intake (+https://baeventos.com)' } })
    const location = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel()
      if (hop >= MAX_REDIRECTS) throw new Error('too many redirects')
      current = new URL(location, current).toString()
      continue
    }
    const type = response.headers.get('content-type') ?? ''
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error(`answered ${response.status}`) }
    if (!/^(text\/html|application\/xhtml\+xml|text\/plain)\b/i.test(type)) { await response.body.cancel(); throw new Error('not an HTML page') }
    if (Number(response.headers.get('content-length')) > MAX_BYTES) { await response.body.cancel(); throw new Error('page exceeds 2 MB') }
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break
        length += value.byteLength; if (length > MAX_BYTES) throw new Error('page exceeds 2 MB')
        chunks.push(value)
      }
    } finally { await reader.cancel().catch(() => {}) }
    const bytes = new Uint8Array(length); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    const charset = type.match(/charset=["']?([\w-]+)/i)?.[1]
    let decoder: TextDecoder
    try { decoder = new TextDecoder(charset ?? 'utf-8') } catch { decoder = new TextDecoder('utf-8') }
    const text = decoder.decode(bytes)
    return /^text\/plain/i.test(type) ? text : visibleText(text)
  }
}
export type ReadPage = (url: string) => Promise<string>

/** The reasons official-page evidence doesn't verify now; empty when every page was fetched and contains its excerpt. */
export const verifyOfficialPagesEffect = (evidence: readonly Evidence[], readPage: ReadPage = url => readOfficialPage(url)) => Effect.gen(function*() {
  const pages = evidence.filter(isOfficialPage)
  const texts = new Map<string, Promise<string>>()
  const reasons: string[] = []
  for (const page of pages) {
    if (!publicPageUrl(page.url)) { reasons.push(`Official page must be a public HTTPS address: ${page.url}`); continue }
    const excerpt = normalizePageText(page.excerpt)
    if (excerpt.length < MIN_EXCERPT) { reasons.push(`Official page excerpt is too short to verify: ${page.url}`); continue }
    if (!texts.has(page.url)) texts.set(page.url, readPage(page.url).then(normalizePageText))
    const text = yield* Effect.promise(() => texts.get(page.url)!.then(value => ({ value }), (error: unknown) => ({ error })))
    if ('error' in text) {
      reasons.push(`Official page could not be read: ${page.url} (${text.error instanceof Error ? text.error.message : String(text.error)})`)
    } else if (!text.value.includes(excerpt)) reasons.push(`Official page evidence must be an excerpt of the page's visible text: ${page.url}`)
  }
  return reasons
})
