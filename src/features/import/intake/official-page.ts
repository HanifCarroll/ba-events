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
const UNREADABLE = 'the site shows a bot check or an empty page to automated readers; cite another official page'
const MISSING_EXCERPT = "Official page evidence must be an excerpt of the page's visible text"
const MISSING_PERFORMANCE = 'Official page date or time evidence must quote the selected future performance'
const INVALID_FANZ_SELECTION = 'Official page could not verify the selected future Fanz performance'
const UNCONFIRMED_HEADING = 'Official page needs its rendered heading to confirm the show name'
const challengeTitle = (title: string | null) => /^(?:Just a moment\.{3}|Request Rejected)$/i.test(title ?? '')
class RenderableReadError extends Error {}

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
export function requireOfficialPageUrl(url: string, sites: ReadonlySet<string>, redirected: boolean) {
  if (!publicPageUrl(url)) throw new Error('not a public HTTPS page')
  const { hostname } = new URL(url)
  if (redirected && siteOf(hostname) === 'queue-it.net') throw new Error('the page sits behind a waiting room; cite another official page')
  if (!officialPageAllowed(url, sites)) throw new Error(`${redirected ? 'redirected to' : 'is on'} ${hostname}, which is not the venue's, organizer's or a ticket seller's site`)
}

/** Accent- and case-insensitive, with every whitespace run as one space: words and numbers keep their boundaries. */
export const normalizePageText = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/gu, ' ').trim()
/** Ordinary ticket-page titles can use a standalone Spanish `y` as an artist separator. */
const nameText = (value: string) => normalizeTitle(value).split(' ').filter(word => word !== 'y').join(' ')
const AGE_RATING = String.raw`(?:atp|apto todo publico|\+(?:13|16|18)|sam (?:13|16|18)|r(?:13|16|18))`
const LEADING_AGE = new RegExp(`^${AGE_RATING} `)
const TRAILING_AGE = new RegExp(` ${AGE_RATING}$`)
function matchesHeading(heading: string, name: string): boolean {
  if (nameText(heading) === name) return true
  const text = normalizePageText(heading)
  return nameText(text.replace(LEADING_AGE, '')) === name || nameText(text.replace(TRAILING_AGE, '')) === name
}
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

type Performance = { text: string; date: string; time: string; title: string }
type SelectedPerformance = Performance & { confirmed: boolean }
type PageRead = { visible: string; title: string | null; h1: string | null; titleName?: string;
  identityNeedsRender?: boolean; selected?: SelectedPerformance | null; calendar?: { site: string; entries: Performance[] } }

const CALENDAR_CITATION = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} \| .+$/
const UNAVAILABLE_PERFORMANCE = /suspend|cancel|reprogram/

/** Read the Cervantes calendar shape, with no guesses from neighboring shows or dates in the page's prose. */
function calendarPerformances($: CheerioAPI, url: URL): Performance[] | undefined {
  const dayCells = $('table td[id^="li-"]')
  if (!dayCells.find('li .calendar-hora').length) return undefined
  const performances: Performance[] = []
  for (const cell of dayCells.toArray()) {
    const date = $(cell).attr('id')!.slice(3)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const midnight = new Date(`${date}T00:00:00Z`)
    if (!Number.isFinite(midnight.getTime()) || !midnight.toISOString().startsWith(`${date}T`)) continue
    for (const entry of $(cell).find('li').toArray()) {
      if ($(entry).closest('td').get(0) !== cell) continue
      const own = (selector: string) => $(entry).find(selector).filter((_, node) => $(node).closest('li').get(0) === entry)
      const starts = own('.calendar-hora')
      const time = starts.length === 1 ? /^((?:[01]\d|2[0-3]):[0-5]\d)(?:\s*hs?\.?)?$/i.exec(starts.text().trim())?.[1] : undefined
      const showLinks = own('a[href]').filter((_, link) => {
        try {
          const target = new URL($(link).attr('href')!, url)
          return publicPageUrl(target.href) && siteOf(target.hostname) === siteOf(url.hostname) && /^\/obra\/[^/]+\/?$/.test(target.pathname)
        } catch { return false }
      })
      const title = showLinks.length === 1 ? showLinks.text().replace(/\s+/g, ' ').trim() : ''
      if (!time || !title) continue
      const ownText = $(entry).clone()
      ownText.find('li').remove()
      if (UNAVAILABLE_PERFORMANCE.test(normalizePageText(ownText.text()))) continue
      performances.push({ date, time, title, text: `${date} ${time} | ${title}` })
    }
  }
  return performances
}

function identity(title: string | null, headings: readonly string[], siteName?: string | null, hasStyles = false) {
  const titleParts = title?.match(/^(.*) (?:-|\|) (.+)$/)
  const [left, right] = (titleParts?.slice(1) ?? []).map(normalizePageText)
  const site = normalizePageText(siteName ?? '')
  const [first, next, ...later] = headings.filter(text => text.trim())
  const heading = normalizePageText(first ?? '')
  const titleShow = heading === left ? right : heading === right ? left : undefined
  // Skip the first visible H1 only if it equals og:site_name or one side of the last " - " / " | " title separator and the next visible H1 equals the other side. The next H1 is then the identity; use the title only when no H1 remains.
  const skip = !!heading && (heading === site || !!titleShow && normalizePageText(next ?? '') === titleShow)
  const titleName = titleParts && site ? (site === right ? titleParts[1] : site === left ? titleParts[2] : undefined) : undefined
  // CSS can hide the apparently corroborating H1 or an intervening heading before it.
  const identityNeedsRender = hasStyles && (skip || !!titleShow && later.some(text => normalizePageText(text) === titleShow))
  return { title, h1: (skip ? next : first) ?? null, titleName, identityNeedsRender }
}

/** Use the matching Fanz event/date IDs to bind the start time, never JSON descriptions or other performances. */
function selectedFanzPerformance(url: URL, requested: URL, fanz: boolean, json: string,
  shown: { visible: string; singleDate: string; rendered: boolean }): SelectedPerformance | null | undefined {
  const originalSelection = requested.searchParams.getAll('eventDateId')
  const selection = url.searchParams.getAll('eventDateId')
  if (!originalSelection.length && !selection.length) return undefined
  const changedSelection = originalSelection.length > 0 && JSON.stringify(originalSelection) !== JSON.stringify(selection)
  // A redirect that drops or changes a selection on the known route cannot fall back to the general schedule.
  if (changedSelection && requested.pathname.startsWith('/event/')) return null
  // Recognize the platform from branding or data before validating the route name or event fields.
  let identified = fanz || /"https:\/\/(?:white-label-(?:logos|banners)|event-banners)-fanz\.s3\.amazonaws\.com\//.test(json)
  try {
    const data = JSON.parse(json)
    const pageProps = data?.props?.pageProps
    const event = pageProps?.event
    identified ||= data?.page === '/event/[eventId]' && !!pageProps?.whiteLabel || !!event && typeof event === 'object' && (
      data?.query?.eventId != null && data.query.eventDateId != null && event.id != null && 'Dates' in event ||
      typeof event.isExternal === 'boolean' && typeof event.timezone === 'string' && ('Dates' in event || 'isFinished' in event))
    if (!identified) return undefined
    if (changedSelection) return null
    const [, slug, eventId] = /^\/event\/((\d+)(?:-[^/]+)?)\/?$/.exec(url.pathname) ?? []
    const [dateId, ...otherDates] = selection
    if (!eventId || !dateId || !/^\d+$/.test(dateId) || otherDates.length) return null
    if (data?.page !== '/event/[eventId]' || data.query?.eventId !== slug || data.query?.eventDateId !== dateId ||
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
    const time = format(start, 'HH:mm')
    const range = `${time} - ${format(end, 'HH:mm')} hs`
    const picker = `Empieza el ${format(start, "EEE dd 'de' MMM yyyy HH:mm")} - ${format(end, 'HH:mm')} hs`
    // A single-date card has a different visible line; only its own date-and-start block can verify it.
    const card = `${format(start, "EEEE, d 'de' MMMM")} ${range}`
    const text = normalizePageText(shown.singleDate) === normalizePageText(card) ? shown.singleDate
      : normalizePageText(shown.visible).includes(normalizePageText(picker)) ? picker : ''
    return { date, title: event.title, time, text, confirmed: shown.rendered }
  } catch { return identified ? null : undefined } // Missing Fanz data cannot verify the selection.
}

export function visibleText(html: string): string {
  const $ = load(html)
  prepareVisibleDom($)
  return $.root().text()
}

function prepareVisibleDom($: CheerioAPI) {
  revealStreamedSegments($)
  $('head, title, script, style, noscript, template, svg, iframe, [hidden], [aria-hidden="true"]').remove()
  $('[style]').filter((_, element) => /display\s*:\s*none|visibility\s*:\s*hidden|(?:^|;)\s*opacity\s*:\s*0(?:\.0+)?(?=\s|;|!|$)/i.test($(element).attr('style') ?? '')).remove()
  // A space at every element boundary: <span>LUNES</span><span>23</span> reads "LUNES 23", never "LUNES23".
  $('*').each((_, element) => { $(element).prepend(' ').append(' ') })
}

/** GET with no cookies or credentials, manual redirects re-checked hop by hop, a time limit and a size limit. */
export async function readOfficialPage(url: string, sites: ReadonlySet<string>, fetcher: typeof fetch = fetch): Promise<PageRead> {
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  let current = url
  for (let hop = 0; ; hop++) {
    requireOfficialPageUrl(current, sites, hop > 0)
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
    if (!response.ok || !response.body) {
      await response.body?.cancel()
      if ([403, 503].includes(response.status)) throw new RenderableReadError(`answered ${response.status}`)
      throw new Error(`answered ${response.status}`)
    }
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
    const fanz = $ ? fanzLink($('a[href]').map((_, element) => $(element).attr('href')).get()) : false
    const fanzJson = $?.('script#__NEXT_DATA__[type="application/json"]:not([src])').text() ?? ''
    // Cheerio's slim parser leaves the document title in place when optional head tags are omitted.
    const title = ($ && $('head > title, html > title').add($.root().children('title')).first().text().replace(/\s+/g, ' ').trim()) || null
    const site = $?.('meta[property="og:site_name"]').first().attr('content')
    const hasStyles = !!$?.('style, link[rel~="stylesheet"], link[as="style"]').length
    if ($) prepareVisibleDom($)
    const headings = $?.('h1').map((_, element) => $(element).text().replace(/\s+/g, ' ').trim()).get() ?? []
    const visible = $ ? $.root().text() : text
    // An empty page (Incapsula's stub) or a short Cloudflare challenge page. A protection script alone proves nothing:
    // Imperva and Cloudflare inject theirs into real pages too.
    const shown = visible.replace(/\s+/g, ' ').trim().length
    if (!shown || challengeTitle(title) || shown < CHALLENGE_TEXT && /cf[-_]chl|incapsula incident id/i.test(text)) {
      throw new RenderableReadError(UNREADABLE)
    }
    const cards = $?.(FANZ_SINGLE_DATE)
    const final = new URL(current)
    const selected = selectedFanzPerformance(final, new URL(url), fanz, fanzJson,
      { visible, singleDate: cards?.length === 1 ? cards.text() : '', rendered: false })
    const entries = $ && selected === undefined ? calendarPerformances($, final) : undefined
    const calendar = entries === undefined ? undefined : { site: siteOf(final.hostname), entries }
    return { visible, ...identity(title, headings, site, hasStyles), ...(selected !== undefined ? { selected } : {}), ...(calendar ? { calendar } : {}) }
  }
}
export type ReadPage = (url: string, sites: ReadonlySet<string>) => Promise<PageRead>
export type RenderPage = (url: string, sites: ReadonlySet<string>, excerpts: readonly RegExp[]) => Promise<PageRead & { url: string }>
export const FANZ_SINGLE_DATE = '[class*="styles_singleDateContainer__"]'
const fanzLink = (links: readonly (string | undefined)[]) => links.some(link => /^https:\/\/(?:www\.)?fanz\.com\.ar\/?$/i.test(link ?? ''))

export function renderedPageRead(requested: string, snapshot: { url: string; visible: string; title: string; headings: string[];
  siteName: string | null; fanzLinks: string[]; fanzJson: string; singleDate: string; challenge: boolean }): PageRead & { url: string } {
  const { url, visible, title, headings, siteName, fanzLinks, fanzJson, singleDate, challenge } = snapshot
  if (challenge || challengeTitle(title) || !visible.trim()) throw new Error(UNREADABLE)
  if (visible.length > MAX_BYTES) throw new Error('page exceeds 2 MB')
  const selected = selectedFanzPerformance(new URL(url), new URL(requested), fanzLink(fanzLinks), fanzJson, { visible, singleDate, rendered: true })
  return { url, visible, ...identity(title || null, headings, siteName), ...(selected !== undefined ? { selected } : {}) }
}

/** The candidate facts a page excerpt must back: its name, its BA date, and its BA time when it has one. */
export type PageFacts = { name: string; date: string; time: string | null; sites: ReadonlySet<string>; venueWebsite?: string | null }

const MONTHS = ['ene(?:ro)?', 'feb(?:rero)?', 'mar(?:zo)?', 'abr(?:il)?', 'may(?:o)?', 'jun(?:io)?',
  'jul(?:io)?', 'ago(?:sto)?', 'sep(?:t(?:iembre)?)?|set(?:iembre)?', 'oct(?:ubre)?', 'nov(?:iembre)?', 'dic(?:iembre)?']
const MONTH_PREFIXES = MONTHS.map(pattern => pattern.slice(0, 3))
const MONTH_NAME = new RegExp(String.raw`\b(?:${MONTHS.join('|')})\b`, 'g')
const monthNumber = (name: string) => MONTH_PREFIXES.indexOf(name.slice(0, 3).replace('set', 'sep')) + 1
const DATE = new RegExp(String.raw`\b(?<!\d[./-])(?:(?<isoYear>\d{4})-(?<isoMonth>\d{2})-(?<isoDay>\d{2})|(?<day>\d{1,2})(?:(?<sep>[./-])(?<month>\d{1,2})(?:\k<sep>(?<numericYear>\d{4}|\d{2}))?| (?:de )?(?<monthName>${MONTHS.join('|')})(?:[.,]? (?:del? )?(?<year>\d{4}))?))\b(?![./-]\d)`, 'g')
const CLOCK_VALUE = String.raw`\d{1,2}(?:[:.]\d{2})?`
const CLOCK_LIST = new RegExp(String.raw`\b(?<!\d[:./-])(?:a las? ${CLOCK_VALUE}(?:,| (?:y|o|e|u)) ${CLOCK_VALUE}\b|${CLOCK_VALUE} (?:y|o|e|u) ${CLOCK_VALUE} ?(?:hs?|horas|[ap]\.? ?m)\b)`)
const MULTIPLE_OCCURRENCES = "lists multiple dates or start times; cite the single occurrence's line"
const BARE_START_RANGE = new RegExp(String.raw`\b(?<!\d[:./-])(de )?(\d{1,2})(?: *[-–—] *| (?:a|hasta) (las? )?)(${CLOCK_VALUE})(?: ?(hs?|horas|[ap]\.? ?m))?\b(?![:.]\d)`, 'g')
const CLOCK = /\b(?<!\d[:./])(?:(?<!\d-)|(?=\d{1,2}:))(?:(a las?) )?(\d{1,2})(?:([:.])(\d{2}))?(?: ?(?:([ap])\.? ?m\b\.?|(hs?|horas)\b\.?))?(?![\w:]|\.\d)/g
const DOORS_WORD = /\b(?:puertas?|apertura|abren|abre|doors|open)\b/
const DOORS_REASON = "mentions a doors time; cite a line that states the show's start"
const PAIR_CLOCK = String.raw`([01]?\d|2[0-3])(?::([0-5]\d)(?: ?(?:hs?|horas)\.?)?| ?(?:hs?|horas)\.?)`
const LABEL_GAP = '(?: *: *| +)'
const DOORS_PAIR = new RegExp(`^(.+?) (?:puertas?|apertura(?: de puertas?)?|doors)${LABEL_GAP}${PAIR_CLOCK}` +
  ` *[|/–—-] *(?:show|inicio|funcion|comienza)${LABEL_GAP}${PAIR_CLOCK}$`)
type Clock = { hour: number; minute: number }
const validClock = ({ hour, minute }: Clock) => hour >= 0 && hour <= 23 && minute <= 59
const WEEKDAYS = 'lun(?:es)?|mar(?:tes)?|mie(?:rcoles)?|jue(?:ves)?|vie(?:rnes)?|sab(?:ado)?|dom(?:ingo)?'
const EXPLICIT_DAY_PREFIX = new RegExp(String.raw`\b(?:dia|${WEEKDAYS})[.,:]? (?:el )?$`)
const DAY_ONLY = new RegExp(String.raw`\b(?:el|dia|${WEEKDAYS}|${MONTHS.join('|')})[.,:]? (\d{1,2})\b(?![./-]\d)`, 'g')
const JOINED_DAYS = /\b\d{1,2}\b *(?:[,–—-]|y\b|o\b|al\b) *#|# *(?:[,–—-]|\by\b|\bo\b|\bal\b) *\d{1,2}\b(?! [a-z])/

/** Doors mentions use one complete shape; never infer clock roles from nearby words. */
function doorsAndShow(excerpt: string) {
  const match = DOORS_PAIR.exec(excerpt)
  if (!match) return null
  const [, dateText, doorsHour, doorsMinute = '00', showHour, showMinute = '00'] = match
  if (DOORS_WORD.test(dateText) || Number(showHour) * 60 + Number(showMinute) < Number(doorsHour) * 60 + Number(doorsMinute)) return null
  return { dateText, time: `${showHour.padStart(2, '0')}:${showMinute}` }
}

/** Why a normalized excerpt doesn't state the facts it is cited for; null when it does. */
export function excerptFactsReason(excerpt: string, fields: readonly string[], facts: PageFacts): string | null {
  if (!fields.includes('date') && !fields.includes('time')) return null
  const mentionsDoors = DOORS_WORD.test(excerpt)
  const pair = mentionsDoors ? doorsAndShow(excerpt) : null
  if (mentionsDoors && !pair) return DOORS_REASON
  const schedule = pair?.dateText ?? excerpt
  if (CLOCK_LIST.test(schedule)) return pair ? DOORS_REASON : MULTIPLE_OCCURRENCES
  const [year, month, day] = facts.date.split('-').map(Number)
  const starts: Clock[] = []
  let previousClockEnd: number | undefined
  const afterHourRanges = schedule.replace(BARE_START_RANGE, (token, from: string, start: string, at: string, end: string, unit: string, offset: number) => {
    // Recognize an explicit calendar day before trying to parse a bare range start.
    if (!from && (at || EXPLICIT_DAY_PREFIX.test(schedule.slice(0, offset))) || !unit && !/[.:]/.test(end)) return token
    // Without an explicit meridiem on the start, don't infer it from the end.
    starts.push({ hour: unit && /^[ap]/.test(unit) ? -1 : Number(start), minute: 0 })
    return ' '
  })
  // Remove clock tokens before reading the calendar so hours and minutes cannot stand in for dates.
  const calendar = afterHourRanges.replace(CLOCK, (token, prefix: string, h: string, separator: string, m: string, period: string, unit: string, offset: number) => {
    // A bare number is a day, not a clock; an explicit unit or meridiem ("viernes 20 hs") still makes it a clock.
    if (separator !== ':' && !prefix && !period && !unit) return token
    const hours = Number(h)
    const localHour = period && hours >= 1 && hours <= 12 ? hours % 12 + (period === 'p' ? 12 : 0) : period ? -1 : hours
    const betweenClocks = previousClockEnd === undefined ? null : afterHourRanges.slice(previousClockEnd, offset)
    const rangeEnd = betweenClocks !== null && (/^(?:\s*[-–—]\s*| (?:a|hasta)(?: las?)? )$/.test(betweenClocks) || !!prefix && betweenClocks === ' ')
    previousClockEnd = offset + token.length
    if (!rangeEnd) starts.push({ hour: localHour, minute: Number(m ?? 0) })
    return ' '
  })
  const dates = [...calendar.matchAll(DATE)]
  const partialCalendar = calendar.replace(DATE, '#')
  const contextualDays = [...partialCalendar.matchAll(DAY_ONLY)]
  const dateCount = dates.length + contextualDays.length
  // Mark recognized dates so a shorthand list such as "20 y 21 de noviembre" also holds.
  const joinedDays = JOINED_DAYS.test(partialCalendar.replace(DAY_ONLY, '#'))
  if (pair && (starts.length || dateCount !== 1 || joinedDays)) return DOORS_REASON
  if (starts.length > 1 || dateCount > 1 || joinedDays) return MULTIPLE_OCCURRENCES
  const groups = dates[0]?.groups
  const statedDay = groups?.isoDay ?? groups?.day ?? contextualDays[0]?.[1]
  if (Number(statedDay) !== day) return `does not state the day ${day}`
  const wrongMonth = `does not state the month ${String(month).padStart(2, '0')}`
  const wrongYear = `does not state the year ${year}`
  if (groups) {
    const statedMonth = groups.monthName ? monthNumber(groups.monthName) : Number(groups.isoMonth ?? groups.month)
    const statedYear = groups.isoYear ?? groups.year ?? groups.numericYear
    if (statedMonth !== month) return wrongMonth
    if (statedYear && Number(statedYear) !== (statedYear.length === 2 ? year % 100 : year)) return wrongYear
  }
  // A month heading or a separated year still constrains the quoted occurrence.
  for (const { 0: name, index } of calendar.matchAll(MONTH_NAME)) {
    // Before a day number, bare "mar" is the weekday abbreviation. A month after the day is checked above.
    if (name === 'mar' && /^[.,]? \d{1,2}\b/.test(calendar.slice(index + name.length))) continue
    if (monthNumber(name) !== month) return wrongMonth
  }
  for (const [number] of calendar.matchAll(/\b(?:19|20)\d{2}\b/g)) if (Number(number) !== year) return wrongYear
  if (pair) return facts.time === pair.time ? null : `states the show starts at ${pair.time}; set the candidate's start time to match`
  const start = starts[0]
  if (!start || !validClock(start)) {
    return facts.time ? `does not state the time ${facts.time}` : 'does not state a start time'
  }
  const [hour, minute] = facts.time?.split(':').map(Number) ?? []
  if (facts.time && (start.hour !== hour || start.minute !== minute)) return `does not state the time ${facts.time}`
  return null
}

function pageReason({ visible, title, titleName, h1, selected, calendar, identityNeedsRender }: PageRead, quoted: RegExp, excerpt: string,
  fields: readonly string[], facts: PageFacts, missing: string | null): string | null {
  if (calendar) {
    if (fields.some(field => field !== 'date' && field !== 'time')) return 'A calendar performance excerpt can only support date and time'
    const venueHost = facts.venueWebsite && hostOf(facts.venueWebsite)
    if (!venueHost || calendar.site !== siteOf(venueHost)) return "Official page calendar evidence must be on the selected venue's stored website"
    const name = normalizeTitle(facts.name)
    const match = calendar.entries.find(entry => normalizePageText(entry.text) === excerpt && entry.date === facts.date &&
      name && normalizeTitle(entry.title) === name)
    if (!match) return 'Official page calendar evidence must quote the matching performance line (YYYY-MM-DD HH:mm | Show title)'
    return facts.time === match.time ? null : `Official page calendar performance starts at ${match.time}; set the candidate's start time to match`
  }
  if (missing) return `Official page excerpt ${missing}`
  const timingEvidence = fields.some(field => field === 'date' || field === 'time')
  if (selected === null && timingEvidence) return INVALID_FANZ_SELECTION
  if (selected && quoted.test(normalizePageText(selected.text))) {
    if (fields.some(field => field !== 'date' && field !== 'time')) return 'The selected performance excerpt can only support date and time'
    // Only the browser can tell whether a Fanz picker or card is visible under the site's stylesheet.
    if (!selected.confirmed) return MISSING_PERFORMANCE
    if (selected.date !== facts.date) return `Official page excerpt does not state the selected performance date ${facts.date}`
    if (fields.includes('time') && facts.time && (selected.time !== facts.time || !excerpt.includes(selected.time))) {
      return `Official page excerpt does not state the performance start time ${facts.time}`
    }
    const selectedName = normalizeTitle(facts.name)
    if (!selectedName || normalizeTitle(selected.title) !== selectedName) return `Official page selected performance is not for "${facts.name}"${pageTitleHint(selected.title)}`
  } else if (selected && timingEvidence) {
    return MISSING_PERFORMANCE
  } else if (!quoted.test(normalizePageText(visible))) {
    return MISSING_EXCERPT
  }
  if (identityNeedsRender) return UNCONFIRMED_HEADING
  const name = nameText(facts.name)
  if (name && (h1 ? matchesHeading(h1, name) : nameText(titleName ?? title ?? '') === name)) return null
  const headings = [title && `page title: ${JSON.stringify(title.slice(0, 255))}`, h1 && `H1: ${JSON.stringify(h1.slice(0, 255))}`].filter(Boolean).join('; ')
  return `Official page does not name "${facts.name}"${headings ? ` (${headings})` : ''}`
}

const readResult = (pending: Promise<PageRead>) => pending.then(value => ({ value }), (error: unknown) => ({ error }))
const excerptPattern = (excerpt: string) => new RegExp(`(?<![\\p{L}\\p{N}])${excerpt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u')

/** The reasons official-page evidence doesn't verify now; empty when every page was fetched and backs its facts. */
export const verifyOfficialPagesEffect = (evidence: readonly Evidence[], facts: PageFacts, readPage: ReadPage = readOfficialPage,
  renderPage?: RenderPage) => Effect.gen(function*() {
  const pages = evidence.filter(isOfficialPage)
  const groups = new Map<string, Array<{ index: number; quoted: RegExp; check: (page: PageRead) => string | null }>>()
  const reasons: Array<string | undefined> = Array(pages.length)
  for (const [index, page] of pages.entries()) {
    if (!publicPageUrl(page.url)) { reasons[index] = `Official page must be a public HTTPS address: ${page.url}`; continue }
    if (!officialPageAllowed(page.url, facts.sites)) {
      reasons[index] = `Official page must be on the venue's website, a site a cited post links to, the post-backed ticket site, or a known ticket seller: ${page.url}`
      continue
    }
    const excerpt = normalizePageText(page.excerpt)
    if (excerpt.length < MIN_EXCERPT) { reasons[index] = `Official page excerpt is too short to verify: ${page.url}`; continue }
    const missing = excerptFactsReason(excerpt, page.fields, facts)
    // A calendar title can contain dates or clocks, but doors language never bypasses the strict pair rule.
    if (missing && (missing === DOORS_REASON || !CALENDAR_CITATION.test(excerpt))) {
      reasons[index] = `Official page excerpt ${missing}: ${page.url}`; continue
    }
    const quoted = excerptPattern(excerpt)
    const group = groups.get(page.url) ?? []
    group.push({ index, quoted, check: value => pageReason(value, quoted, excerpt, page.fields, facts, missing) })
    groups.set(page.url, group)
  }
  for (const [url, group] of groups) {
    const initial = yield* Effect.promise(() => readResult(readPage(url, facts.sites)))
    let result = initial
    let failures = 'value' in initial ? group.map(item => item.check(initial.value)) : []
    if (renderPage && ('error' in initial ? initial.error instanceof RenderableReadError
      : failures.some(reason => reason === MISSING_EXCERPT || reason === MISSING_PERFORMANCE || reason === INVALID_FANZ_SELECTION || reason === UNCONFIRMED_HEADING))) {
      const hydrated = yield* Effect.promise(() => readResult(renderPage(url, facts.sites, group.map(item => item.quoted)).then(rendered => {
        requireOfficialPageUrl(rendered.url, facts.sites, rendered.url !== url)
        if (!rendered.visible.trim() || challengeTitle(rendered.title)) throw new Error(UNREADABLE)
        // A redirect or changed page cannot switch a recognized Fanz performance to generic page evidence.
        return 'value' in initial && initial.value.selected !== undefined && rendered.selected === undefined
          ? { ...rendered, selected: null } : rendered
      })))
      // Never combine an early static excerpt with another excerpt from the page after hydration.
      result = hydrated
      if ('value' in hydrated) failures = group.map(item => item.check(hydrated.value))
    }
    for (const [position, { index }] of group.entries()) {
      if ('error' in result) reasons[index] = `Official page could not be read: ${url} (${result.error instanceof Error ? result.error.message : String(result.error)})`
      else if (failures[position]) reasons[index] = `${failures[position]}: ${url}`
    }
  }
  return reasons.filter((reason): reason is string => reason !== undefined)
})
