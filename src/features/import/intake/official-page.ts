/** Preview and commit verify evidence against the official page fetched by the jobs Worker. */
import { load, type CheerioAPI } from 'cheerio/slim'
import { es } from 'date-fns/locale'
import { formatInTimeZone } from 'date-fns-tz'
import { Effect } from 'effect'
import { normalizeTitle } from './planning.ts'
import { isOfficialPage, validPublicUrl, type Evidence } from './schema.ts'

const MAX_BYTES = 2_097_152
const TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 3
const MIN_EXCERPT = 8
// A challenge page shows at most a line or two ("Verifying you are human…"); any event page with a name, date and venue is longer.
const CHALLENGE_TEXT = 200

/** Public HTTPS host names only: no IP literals, no single-label or local names. */
export function publicPageUrl(value: string): boolean {
  if (!validPublicUrl(value)) return false
  const host = new URL(value).hostname.toLowerCase()
  return !host.startsWith('[') && !/^[\d.]+$/.test(host) && !/(^|\.)(local|localhost|internal|lan|home|arpa)$/.test(host)
}

// Argentine ticket sellers whose event pages count as official, by registrable domain (checked live on 2026-11-17).
// Ticketportal is left out: no Argentine domain of theirs resolves.
export const TICKET_SELLERS = ['alternativateatral.com', 'plateanet.com', 'ticketek.com.ar', 'passline.com', 'entradaweb.com.ar',
  'eventbrite.com', 'eventbrite.com.ar', 'tuentrada.com', 'livepass.com.ar', 'allaccess.com.ar', 'venti.com.ar', 'venti.live', 'entradauno.com']
// Social sites, link pages, translators, caches and archives never count, even when a venue or caption points at them.
const NEVER = new Set(['instagram.com', 'facebook.com', 'fb.com', 'fb.me', 'x.com', 'twitter.com', 't.co', 'tiktok.com', 'youtube.com',
  'youtu.be', 'linktr.ee', 'translate.goog', 'googleusercontent.com', 'archive.org'])
// shortcut: a small second-level list instead of the Public Suffix List; add a suffix when a venue's site uses another one.
const SECOND_LEVEL = new Set(['com.ar', 'org.ar', 'net.ar', 'gob.ar', 'gov.ar', 'edu.ar', 'tur.ar', 'int.ar', 'com.br', 'com.uy', 'com.mx', 'com.es', 'co.uk'])
/** The registrable domain of a host: `www.teatropicadero.com.ar` → `teatropicadero.com.ar`. */
export function siteOf(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.')
  return labels.slice(SECOND_LEVEL.has(labels.slice(-2).join('.')) ? -3 : -2).join('.')
}
const hostOf = (value: string) => { try { return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname } catch { return null } }

/**
 * The sites whose pages count as official for a candidate: the venue's stored website, the ticket link when a post backs
 * it, any site a cited post's caption links to, and the known ticket sellers. Social and wrapper sites never count.
 */
export function officialSites(sources: { website?: string | null; ticketUrl?: string | null; captions?: readonly string[] }): Set<string> {
  const urls = [sources.website, sources.ticketUrl,
    ...(sources.captions ?? []).flatMap(caption => (caption.match(/\b(?:https?:\/\/|www\.)[^\s<>()"']+/gi) ?? [])
      .map(link => link.replace(/[.,;:!?…]+$/u, '')))]
  const sites = new Set(TICKET_SELLERS)
  for (const url of urls) { const host = url && hostOf(url); if (host && host.includes('.')) sites.add(siteOf(host)) }
  for (const site of NEVER) sites.delete(site)
  return sites
}
export const officialPageAllowed = (url: string, sites: ReadonlySet<string>) => {
  const site = siteOf(new URL(url).hostname)
  return !NEVER.has(site) && sites.has(site)
}

/** Accent- and case-insensitive, with every whitespace run as one space: words and numbers keep their boundaries. */
export const normalizePageText = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/gu, ' ').trim()
/** For event names only: punctuation and a standalone Spanish `y` can be artist separators. */
const nameText = (value: string) => normalizeTitle(value).split(' ').filter(word => word !== 'y').join(' ')
const pageTitleHint = (title: string | null) => title ? ` (page title: ${JSON.stringify(title.slice(0, 255))})` : ''

// React's inline reveal calls: `$RS("S:n","P:m")` moves a segment into a placeholder, `$RC("B:m","S:n")` into a boundary.
const REVEAL = /\$RS\(\s*(["'])(S:\d+)\1\s*,\s*(["'])(P:\d+)\3\s*\)|\$RC\(\s*(["'])(B:\d+)\5\s*,\s*(["'])(S:\d+)\7\s*\)/g

/**
 * Replays the reveal calls of a streamed Next.js/React page in script order, moving each hidden segment where the browser
 * puts it. A segment without a call or a destination stays hidden, and content moved into a still-hidden parent stays hidden.
 */
function revealStreamedSegments($: CheerioAPI) {
  for (const script of $('script:not([src])').toArray()) {
    for (const [, , placed, , placeholder, , boundary, , boundarySegment] of $(script).text().matchAll(REVEAL)) {
      const segment = $(`div[hidden][id="${placed ?? boundarySegment}"]`).first()
      const target = $(`[id="${placeholder ?? boundary}"]`).first()
      if (!segment.length || !target.length) continue
      if (placeholder) { target.replaceWith(segment.contents()); segment.remove(); continue }
      // The boundary's fallback runs from its template to the matching `<!--/$-->`; nested boundaries open with `<!--$…-->`.
      type Node = { type: string; data?: string; nextSibling: Node | null }
      const fallback: Node[] = []; let node: Node | null = target[0] as unknown as Node; let depth = 0
      for (; node && !(node.type === 'comment' && node.data === '/$' && depth === 0); node = node.nextSibling) {
        if (node.type === 'comment') depth += node.data === '/$' ? -1 : /^\$[?!~]?$/.test(node.data ?? '') ? 1 : 0
        fallback.push(node)
      }
      if (!node) continue
      // Inserted before the template (an element): cheerio's `before` does nothing on a comment node.
      target.before(segment.contents())
      for (const item of fallback) $(item as never).remove()
      segment.remove()
    }
  }
}

type SelectedPerformance = { text: string; date: string; time: string; title: string }
type Listing = { text: string; title?: string | null; primary?: boolean }
type PageRead = { visible: string; title: string | null; listings: Listing[]; selected?: SelectedPerformance | null }
const camarinPerformanceUrl = (url: URL) => /^(?:www\.)?elcamarindelasmusas\.com$/.test(url.hostname) &&
  url.pathname.startsWith('/event/') && url.searchParams.has('eventDateId')

/** Fanz renders El Camarín's selected performance in the browser, from the matching event and date IDs. */
function selectedCamarinPerformance($: CheerioAPI, url: URL): SelectedPerformance | null {
  const eventId = /^\/event\/(\d+)\/?$/.exec(url.pathname)?.[1]
  const [dateId, ...otherDates] = url.searchParams.getAll('eventDateId')
  if (!eventId || !dateId || !/^\d+$/.test(dateId) || otherDates.length) return null
  try {
    const data = JSON.parse($('script#__NEXT_DATA__[type="application/json"]:not([src])').text())
    const event = data?.props?.pageProps?.event
    if (data?.page !== '/event/[eventId]' || data.query?.eventId !== eventId || data.query?.eventDateId !== dateId ||
        event?.id !== Number(eventId) || typeof event.title !== 'string' || !event.title.trim() || event.isExternal !== false || !Array.isArray(event.Dates) ||
        !['America/Buenos_Aires', 'America/Argentina/Buenos_Aires'].includes(event.timezone)) return null
    const dates: Array<{ id?: unknown; start?: unknown; end?: unknown }> = event.Dates
    const matches = dates.filter(date => date?.id === Number(dateId))
    if (matches.length !== 1) return null
    const [{ start, end }] = matches
    const iso = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
      new Date(value).toISOString() === value
    if (!iso(start) || !iso(end) || end < start || Date.parse(start) <= Date.now()) return null
    const format = (value: string, pattern: string) => formatInTimeZone(value, 'America/Argentina/Buenos_Aires', pattern, { locale: es })
    const date = format(start, 'yyyy-MM-dd')
    // shortcut: only render the observed same-day range; add other formats once verified in the browser.
    if (date !== format(end, 'yyyy-MM-dd')) return null
    return { date, title: event.title, time: format(start, 'HH:mm'), text: `Empieza el ${format(start, "EEE dd 'de' MMM yyyy HH:mm")} - ${format(end, 'HH:mm')} hs` }
  } catch { return null } // Missing or changed page data cannot verify the selected date or time.
}

export function visibleText(html: string): string {
  const $ = load(html)
  prepareVisibleDom($)
  return $.root().text()
}

function prepareVisibleDom($: CheerioAPI) {
  revealStreamedSegments($)
  $('head, script, style, noscript, template, svg, iframe, [hidden], [aria-hidden="true"]').remove()
  $('[style]').filter((_, element) => /display\s*:\s*none|visibility\s*:\s*hidden/i.test($(element).attr('style') ?? '')).remove()
  // A space at every element boundary: <span>LUNES</span><span>23</span> reads "LUNES 23", never "LUNES23".
  $('*').each((_, element) => { $(element).prepend(' ').append(' ') })
}

// These headings label a performance picker or show details, not another show's listing.
const SECTION_LABELS = new Set(['funciones', 'proximas funciones', 'funciones disponibles', 'fecha', 'fechas', 'horarios',
  'fecha hora', 'fecha horario', 'fecha lugar', 'fechas horarios', 'fecha hora lugar', 'date time', 'dates times',
  'entradas', 'precios', 'sinopsis', 'ficha tecnica', 'ubicacion', 'informacion'])
const SHOW_HEADINGS = 'h1, h2, h3'
const HEADINGS = `${SHOW_HEADINGS}, h4, h5, h6`
const LISTING_BOUNDARY = 'ba-intake-listing-boundary'
const DATE_CELL = /^(?:(?:lun(?:es)?|mar(?:tes)?|mie(?:rcoles)?|jue(?:ves)?|vie(?:rnes)?|sab(?:ado)?|dom(?:ingo)?)(?:$| )|\d{1,2} (?:de )?(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b|[\d ]+(?: (?:h|hs|am|pm|p m|a m))?$)/u
const RECOMMENDATION_LABEL = /\b(?:(?:tambien )?te (?:puede interesar|recomendamos|podria interesar)|(?:eventos|espectaculos|obras|shows) (?:recomendad[oa]s|similares|relacionad[oa]s)|(?:more|related|recommended|similar) events|you (?:may|might) also like)\b/
const listingTitles = (headings: string[]) => [...new Set(headings.map(nameText).filter(name => name && !SECTION_LABELS.has(name)))]

function pageListings($: CheerioAPI, title: string | null) {
  const visible = $.root().text()
  // Ignore navigation and recommendations even when they embed their own event cards.
  $('aside, nav, footer, [role="complementary"], [role="navigation"], [role="contentinfo"], .sidebar, #sidebar,' +
    ' [class*="recommend" i], [class*="related-events" i], [class*="recomend" i], [class*="relacionad" i],' +
    ' [id*="recommend" i], [id*="related-events" i], [id*="recomend" i], [id*="relacionad" i]').remove()
  $('[aria-label]').filter((_, el) => RECOMMENDATION_LABEL.test(nameText($(el).attr('aria-label') ?? ''))).remove()
  $('section, article, div, [role="region"]').filter((_, el) => {
    const label = $(el).children().first()
    return label.is('p, strong, [role="heading"]') && RECOMMENDATION_LABEL.test(nameText(label.text()))
  }).remove()
  for (const el of $(HEADINGS).toArray()) {
    if (!RECOMMENDATION_LABEL.test(nameText($(el).text()))) continue
    const heading = $(el)
    let header = heading
    const label = nameText(heading.text())
    while (header.parent().is('header, div') && nameText(header.parent().text()) === label) header = header.parent()
    const container = header.parent()
    if (container.is('section, article, div, [role="region"]') && container.find(HEADINGS).first().is(heading)) {
      container.remove()
    } else {
      // Some templates put the recommendations directly after a heading instead of wrapping them in a section.
      header.nextUntil(HEADINGS.split(', ').slice(0, Number(el.name.slice(1))).join(', ')).remove()
      header.remove()
    }
  }
  // Without a show heading, require the name and excerpt in the same paragraph or row, not just the same article.
  const listings: Listing[] = $('p').toArray().flatMap(el => {
    const paragraph = $(el).clone()
    paragraph.find('br').replaceWith('\u2028')
    return paragraph.text().split('\u2028').filter(text => !RECOMMENDATION_LABEL.test(nameText(text))).map(text => ({ text }))
  })
  const h1Count = listingTitles($('h1').map((_, el) => $(el).text()).get()).length
  // Inspect independent listings from the inside out. Their dates cannot be borrowed by an enclosing listing.
  const blocks = $(`body, main, article, section, li, tr, [data-event-id], [itemtype$="/Event"],
    a[href]:has(${SHOW_HEADINGS}), div:has(> :is(${SHOW_HEADINGS})), div:has(> header > :is(${SHOW_HEADINGS}))`).toArray().reverse()
  for (const el of [...blocks, ...$.root().toArray()]) {
    const block = $(el)
    const names = listingTitles(block.find(SHOW_HEADINGS).map((_, el) => $(el).text()).get())
    const cells = block.is('tr') ? block.children('th, td') : null
    // A named row owns its date regardless of column order. An ambiguous row stays out of the parent listing.
    if (cells && cells.length > 1 && cells.is('td')) {
      for (const label of listingTitles(cells.map((_, cell) => $(cell).text()).get())) {
        if (!DATE_CELL.test(label) && !names.includes(label)) names.push(label)
      }
    }
    const text = block.text()
    const eventBlock = block.is('article, [data-event-id], [itemtype$="/Event"]')
    const linkedCard = block.is('a[href]') && names.length > 0 && names[0] !== nameText(text)
    const standalone = eventBlock || linkedCard || names.length > 1 || names.length === 1 && names[0] !== nameText(text)
    const hasBoundary = block.find(LISTING_BOUNDARY).length > 0
    if (eventBlock && !hasBoundary && !names.length && !h1Count && title && nameText(block.children().first().text()) === nameText(title)) {
      // A title-only page can identify its event with a plain label rather than a heading.
      listings.push({ text, title })
    } else if ((cells || linkedCard) && !hasBoundary && names.length < 2 && !RECOMMENDATION_LABEL.test(nameText(text))) {
      listings.push({ text, title: names[0] })
    } else if (names.length) {
      // A heading owns only the text after it and before the next competing heading.
      let listing: Listing | undefined
      const pending = block.contents().toArray().reverse()
      while (pending.length > 0) {
        const node = $(pending.pop()!)
        const own = node.is(SHOW_HEADINGS) ? listingTitles([node.text()])[0] : undefined
        if (node.is(LISTING_BOUNDARY)) {
          // Text after a detached listing could still belong to it, not the preceding show.
          listing = undefined
        } else if (own) {
          listing = { title: own, text: node.text(), primary: h1Count === 1 && node.is('h1') }
          listings.push(listing)
        } else if (node[0]?.type === 'text') {
          if (listing) listing.text += node.text()
        } else {
          for (const child of node.contents().toArray().reverse()) pending.push(child)
        }
      }
    }
    if (standalone && el.type !== 'root') block.replaceWith(`<${LISTING_BOUNDARY}></${LISTING_BOUNDARY}>`)
  }
  if (!h1Count && title && !$(LISTING_BOUNDARY).length && !listingTitles($(SHOW_HEADINGS).map((_, el) => $(el).text()).get()).length) {
    listings.push({ text: $.root().text(), title })
  }
  return { visible, listings }
}

/** GET with no cookies or credentials, manual redirects re-checked hop by hop, a time limit and a size limit. */
export async function readOfficialPage(url: string, sites: ReadonlySet<string>, fetcher: typeof fetch = fetch): Promise<PageRead> {
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  let current = url
  for (let hop = 0; ; hop++) {
    if (!publicPageUrl(current)) throw new Error('not a public HTTPS page')
    if (!officialPageAllowed(current, sites)) throw new Error(`${hop ? 'redirected to' : 'is on'} ${new URL(current).hostname}, which is not the venue's, organizer's or a ticket seller's site`)
    const response = await fetcher(current, { redirect: 'manual', signal,
      headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5', 'User-Agent': 'BA Eventos intake (+https://baeventos.com)' } })
    const location = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel()
      const next = new URL(location, current)
      if (siteOf(next.hostname) === 'queue-it.net') throw new Error('the page sits behind a waiting room; cite another official page')
      if (hop >= MAX_REDIRECTS) throw new Error('too many redirects')
      current = next.toString()
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
    const $ = /^text\/plain/i.test(type) ? null : load(text)
    const source = new URL(current)
    const camarin = camarinPerformanceUrl(source)
    const selected = $ && camarin ? selectedCamarinPerformance($, source) : null
    const title = $?.('head title').first().text().replace(/\s+/g, ' ').trim() || null
    if ($) prepareVisibleDom($)
    const { visible, listings } = $ ? pageListings($, title) : { visible: text, listings: (text.match(/[^\r\n]{8,}/g) ?? []).map(text => ({ text })) }
    // An empty page (Incapsula's stub) or a short Cloudflare challenge page. A protection script alone proves nothing:
    // Imperva and Cloudflare inject theirs into real pages too.
    const shown = visible.replace(/\s+/g, ' ').trim().length
    if (!shown || shown < CHALLENGE_TEXT && /<title>\s*Just a moment\.\.\.\s*<\/title>|cf[-_]chl/i.test(text)) {
      throw new Error('the site shows a bot check or an empty page to automated readers; cite another official page')
    }
    return { visible, title, listings, ...(camarin ? { selected } : {}) }
  }
}
export type ReadPage = (url: string, sites: ReadonlySet<string>) => Promise<PageRead>

/** The candidate facts a page excerpt must back: its name, its BA date, and its BA time when it has one. */
export type PageFacts = { name: string; date: string; time: string | null; sites: ReadonlySet<string> }

/** Why an excerpt doesn't state the date or time it is cited for; null when it does. Digit runs are compared as numbers. */
export function excerptFactsReason(excerpt: string, fields: readonly string[], facts: PageFacts): string | null {
  const runs = (excerpt.match(/\d+/g) ?? []).filter(run => run.length <= 2).map(Number)
  const day = Number(facts.date.slice(8, 10))
  if (fields.includes('date') && !runs.includes(day)) return `does not state the day ${day}`
  if (fields.includes('time') && facts.time) {
    const [hour, minute] = facts.time.split(':').map(Number)
    const pm = /\bp\.?\s?m\b/i.test(excerpt)
    const hours = pm && hour >= 12 ? [hour, hour === 12 ? 12 : hour - 12] : [hour]
    if (!hours.some(value => runs.includes(value)) || minute !== 0 && !runs.includes(minute)) return `does not state the time ${facts.time}`
  }
  return null
}

/** The reasons official-page evidence doesn't verify now; empty when every page was fetched and backs its facts. */
export const verifyOfficialPagesEffect = (evidence: readonly Evidence[], facts: PageFacts, readPage: ReadPage = readOfficialPage) => Effect.gen(function*() {
  const pages = evidence.filter(isOfficialPage)
  const texts = new Map<string, Promise<PageRead>>()
  const reasons: string[] = []
  const name = nameText(facts.name)
  for (const page of pages) {
    if (!publicPageUrl(page.url)) { reasons.push(`Official page must be a public HTTPS address: ${page.url}`); continue }
    if (!officialPageAllowed(page.url, facts.sites)) {
      reasons.push(`Official page must be on the venue's website, a site a cited post links to, the post-backed ticket site, or a known ticket seller: ${page.url}`)
      continue
    }
    const excerpt = normalizePageText(page.excerpt)
    if (excerpt.length < MIN_EXCERPT) { reasons.push(`Official page excerpt is too short to verify: ${page.url}`); continue }
    const missing = excerptFactsReason(excerpt, page.fields, facts)
    if (missing) { reasons.push(`Official page excerpt ${missing}: ${page.url}`); continue }
    if (!texts.has(page.url)) texts.set(page.url, readPage(page.url, facts.sites))
    const text = yield* Effect.promise(() => texts.get(page.url)!.then(value => ({ value }), (error: unknown) => ({ error })))
    if ('error' in text) {
      reasons.push(`Official page could not be read: ${page.url} (${text.error instanceof Error ? text.error.message : String(text.error)})`)
      continue
    }
    const { visible, title, listings, selected } = text.value
    const quoted = new RegExp(`(?<![\\p{L}\\p{N}])${excerpt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u')
    if (selected && quoted.test(normalizePageText(selected.text))) {
      if (page.fields.some(field => field !== 'date' && field !== 'time')) {
        reasons.push(`The selected performance excerpt can only support date and time: ${page.url}`)
        continue
      }
      if (selected.date !== facts.date) {
        reasons.push(`Official page excerpt does not state the selected performance date ${facts.date}: ${page.url}`)
        continue
      }
      if (page.fields.includes('time') && facts.time && (selected.time !== facts.time || !excerpt.includes(selected.time))) {
        reasons.push(`Official page excerpt does not state the performance start time ${facts.time}: ${page.url}`)
        continue
      }
      if (!name || nameText(selected.title) !== name) reasons.push(`Official page selected performance is not for "${facts.name}"${pageTitleHint(selected.title)}: ${page.url}`)
      continue
    }
    if ((selected !== undefined || camarinPerformanceUrl(new URL(page.url))) && page.fields.some(field => field === 'date' || field === 'time')) {
      reasons.push(`Official page date or time evidence must quote the selected future performance: ${page.url}`)
    } else if (!quoted.test(normalizePageText(visible))) {
      reasons.push(`Official page evidence must be an excerpt of the page's visible text: ${page.url}`)
    } else if (!name || !listings.some(listing => {
      if (!quoted.test(normalizePageText(listing.text))) return false
      if (!listing.title) return ` ${nameText(listing.text)} `.includes(` ${name} `)
      const heading = nameText(listing.title)
      // Require both the primary heading and page title to identify the show when they add ticket or venue copy.
      return heading === name || listing.primary === true && ` ${heading} `.includes(` ${name} `) &&
        ` ${nameText(title ?? '')} `.includes(` ${name} `)
    })) {
      reasons.push(`Official page does not name "${facts.name}"${pageTitleHint(title)}: ${page.url}`)
    }
  }
  return reasons
})
