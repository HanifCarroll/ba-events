import type { EventInsert } from '#shared/lib/types.ts'
import type { Candidate } from './schema.ts'
import { isOfficialPage, validPublicUrl } from './schema.ts'
import { citesCreditName, isExcludedCreditName } from '#shared/lib/event-credit-evidence.ts'
import { TICKET_SELLERS } from '#shared/lib/ticket-sellers.ts'
import { citesClock, citesDateAndClock, normalizeEvidenceText } from './clock-evidence.ts'

export type Observation = {
  id: string; post_id: string; source_username: string; caption: string;
  observed_at: string; post_url: string; authority: 'organizer' | 'venue' | 'curator';
  media_urls?: string[];
}
export type Media = { id: string; observation_id: string; object_key: string; content_type: string; sha256: string }
export type CatalogMatch = {
  id: string; name: string; starts_at: string; venue_id: string | null;
  ticket_url: string | null; link: string | null; updated_at: string; status: string;
  time_tba?: boolean;
}
export type MatchDecision = { action: 'create' | 'update' | 'link' | 'held'; target: CatalogMatch | null; reasons: string[] }

export const normalizeTitle = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const sellerDomains = TICKET_SELLERS.map(domain => RegExp.escape(domain)).join('|')
const ticketTokens = new RegExp(String.raw`(?<![\p{L}\p{N}_.@/-])(?:https?://|www\.|(?:${sellerDomains})(?![\p{L}\p{N}-]))[^\s<>"“”]*`, 'giu')

export function canonicalTicket(value: string | null): string | null {
  if (!value) return null
  const explicitScheme = /^https?:\/\//i.test(value)
  const https = explicitScheme ? value.replace(/^http:\/\//i, 'https://') : `https://${value}`
  if (!validPublicUrl(https)) return null
  const url = new URL(https)
  if (!explicitScheme && !/^www\./i.test(value) && !TICKET_SELLERS.includes(url.hostname)) return null
  url.hostname = url.hostname.replace(/^www\./i, '')
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|igshid$)/i.test(key)) url.searchParams.delete(key)
  url.searchParams.sort()
  return `${url.origin}${url.pathname.replace(/\/$/, '')}${url.search}`
}
function stripTicketPunctuation(token: string): string {
  const openingFor: Readonly<Record<string, string>> = { ')': '(', ']': '[', '}': '{' }
  let url = token
  for (;;) {
    url = url.replace(/[.,;:!?…’']+$/u, '')
    const close = url.at(-1) ?? ''
    const open = openingFor[close]
    if (!open || url.split(close).length <= url.split(open).length) return url
    url = url.slice(0, -1)
  }
}

/** Read complete URL tokens from the source, so a quote cannot cut off a path or query. */
export function citesTicketDestination(excerpt: string, ticket: string, caption = excerpt): boolean {
  const destination = canonicalTicket(ticket), quote = excerpt.trim()
  if (!destination || !quote) return false
  const tokens = [...caption.matchAll(ticketTokens)].flatMap(({ 0: raw, index }) => {
    const url = stripTicketPunctuation(raw)
    return canonicalTicket(url) === destination ? [{ start: index, end: index + url.length }] : []
  })
  for (let start = caption.indexOf(quote); start !== -1; start = caption.indexOf(quote, start + 1)) {
    if (tokens.some(token => token.start >= start && token.end <= start + quote.length)) return true
  }
  return false
}

export function hasPostTicketEvidence(evidence: Candidate['evidence'], observations: ReadonlyArray<Record<string, unknown>>,
  media: readonly Media[], ticket: string | null | undefined, direct = false): boolean {
  return Boolean(ticket && evidence.some(item => {
    if (isOfficialPage(item) || !item.fields.includes('ticket')) return false
    const post = observations.find(post => post.id === item.observation_id)
    if (!post || direct && post.authority !== 'venue' && post.authority !== 'organizer') return false
    if (item.media_id) return media.some(image => image.id === item.media_id && image.observation_id === post.id) && citesTicketDestination(item.excerpt, ticket)
    return typeof post.caption === 'string' && citesTicketDestination(item.excerpt, ticket, post.caption)
  }))
}

/** Create only: callers separately verify the official page's excerpt, identity, and allowed host. */
export function hasOfficialTicketEvidence(evidence: Candidate['evidence'], ticket: string): boolean {
  const destination = canonicalTicket(ticket)
  return Boolean(destination && evidence.some(item => isOfficialPage(item) && item.fields.includes('ticket') && canonicalTicket(item.url) === destination))
}

export function ticketDestinationChanged(before: unknown, after: string | null | undefined): boolean {
  if (!after) return false
  return typeof before !== 'string' || (canonicalTicket(before) ?? before) !== (canonicalTicket(after) ?? after)
}

export const descriptionChanged = (before: Record<string, unknown>, after: EventInsert) =>
  (before.description_es ?? null) !== (after.description_es ?? null) || (before.description_en ?? null) !== (after.description_en ?? null)

// Updates carry the stored facets unchanged. A venue change supplies new venue text and barrio to the builder.
export const searchInputsChanged = (before: Record<string, unknown>, after: EventInsert) =>
  descriptionChanged(before, after) || before.name !== after.name || (before.venue_id ?? null) !== (after.venue_id ?? null) ||
  (before.price ?? null) !== (after.price ?? null) || Boolean(before.is_free) !== Boolean(after.is_free) ||
  JSON.stringify(before.categories ?? []) !== JSON.stringify(after.categories ?? [])

export const baDate = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(iso))
export const baTime = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Argentina/Buenos_Aires',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))

function localTimestamp(date: string, time: string): string {
  const parsed = new Date(`${date}T${time}:00-03:00`)
  if (Number.isNaN(parsed.getTime()) || baDate(parsed.toISOString()) !== date) throw new Error('Invalid calendar date')
  return parsed.toISOString()
}

/** The timezone is explicit even when the catalog uses a time-TBA placeholder. */
export function candidateStart(candidate: Candidate): string {
  return localTimestamp(candidate.date, candidate.time ?? '00:00')
}

export function candidateDoors(candidate: Candidate): string | undefined {
  if (!candidate.doors_time) return
  return localTimestamp(candidate.doors_date ?? candidate.date, candidate.doors_time)
}

export function retainedIntakeDoors(doors: unknown, sameDay: boolean, startsAt: string, timeTba: boolean | undefined): string | null {
  return sameDay && typeof doors === 'string' && (timeTba || Date.parse(doors) <= Date.parse(startsAt)) ? doors : null
}

export function suppliedDetailFacts(candidate: Candidate): string[] {
  return Object.entries({ organizer: candidate.organizer, performers: candidate.performers,
    offers_valid_from: candidate.offers_valid_from, doors_time: candidate.doors_time })
    .filter(([, value]) => value !== undefined).map(([field]) => field)
}

const wholeLineFields: readonly string[] = ['organizer', 'performers', 'offers_valid_from']
export const requiresWholeCaptionExcerpt = (fields: readonly string[]) => fields.some(field => wholeLineFields.includes(field))

const captionLines = (text: string) => text.trim().split(/\r?\n/u).map(line => line.trim())

export function isWholeCaptionExcerpt(caption: string, excerpt: string): boolean {
  const source = captionLines(caption), quote = captionLines(excerpt)
  return Boolean(excerpt.trim()) && source.some((_, start) => quote.every((line, offset) => source[start + offset] === line))
}

export const SAME_CLOCK_REASON = 'Equal doors and start times need two separate clocks in the doors excerpt'

export function citesIntakeClock(excerpt: string, time: string, caption: string | undefined, wholeLines: boolean, count = 1): boolean {
  if (caption !== undefined && wholeLines) return citesClock(captionLines(excerpt).join('\n'), time, captionLines(caption).join('\n'), count)
  return citesClock(excerpt, time, caption, count)
}

export const SAME_CLOCK_RETAINED_REASON = 'Equal retained doors and start times need two separate clocks in one excerpt'

export function separatelyCitedDoors(evidence: Candidate['evidence'], time: string, observations: readonly Observation[], doorsRetained = false): boolean {
  return evidence.some(item => {
    if (!item.fields.includes('doors_time') && !(doorsRetained && item.fields.includes('time'))) return false
    if (isOfficialPage(item)) return citesClock(normalizeEvidenceText(item.excerpt), time, undefined, 2, { keepAmbiguousMeridiemEnd: false })
    if (item.media_id) return citesClock(item.excerpt, time, undefined, 2)
    const post = observations.find(post => post.id === item.observation_id)
    return post && citesIntakeClock(item.excerpt, time, post.caption, requiresWholeCaptionExcerpt(item.fields), 2)
  })
}

export function validateEvidence(candidate: Candidate, observations: Observation[], media: Media[], now: Date, venueName = candidate.venue_name): string[] {
  const reasons = [...candidate.issues]
  try {
    const start = candidateStart(candidate)
    if (candidate.intent === 'create' && baDate(start) < baDate(now.toISOString())) reasons.push('Event date is in the past')
    if (new Date(start).getTime() > now.getTime() + 370 * 86400000) reasons.push('Event is outside the supported discovery horizon')
  } catch { reasons.push('Invalid calendar date') }
  if (candidate.doors_date && !candidate.doors_time) reasons.push('A separate doors date needs a door time')
  if (candidate.doors_time && candidate.doors_time < '06:00' && !candidate.doors_date) reasons.push('State doors_date for an after-midnight door time')
  try {
    const doors = candidateDoors(candidate)
    if (doors) {
      const dateDistance = Date.parse(`${baDate(doors)}T00:00Z`) - Date.parse(`${candidate.date}T00:00Z`)
      if (Math.abs(dateDistance) > 86_400_000) reasons.push('Door time must be on the event date or an adjacent day')
      if (candidate.time && doors > candidateStart(candidate)) reasons.push('Doors cannot follow the known start time')
    }
  } catch { reasons.push('Invalid doors date') }
  const doorTime = candidate.doors_time
  if (doorTime && doorTime === candidate.time && !separatelyCitedDoors(candidate.evidence, doorTime, observations)) reasons.push(SAME_CLOCK_REASON)
  if (!candidate.venue_id) reasons.push('Venue must be resolved before publishing')
  if (candidate.price_kind === 'fixed' && (!candidate.price_ars || candidate.price_ars < 0)) reasons.push('Fixed price must be positive')
  if (candidate.price_kind !== 'fixed' && candidate.price_ars !== null) reasons.push('Only a fixed price may set price_ars')
  if (candidate.price_kind === 'conditional' && !candidate.price_note) reasons.push('Conditional admission needs its conditions')
  if (candidate.ticket_url && (!validPublicUrl(candidate.ticket_url) || /(^|\.)instagram\.com$/i.test(new URL(candidate.ticket_url).hostname))) reasons.push('Ticket link must be a supported external HTTPS destination')
  const supported = new Set<string>()
  if (candidate.evidence.every(isOfficialPage)) reasons.push('At least one Instagram post must support the candidate')
  for (const evidence of candidate.evidence) {
    // Verified by fetching the page (official-page.ts), not here.
    if (isOfficialPage(evidence)) { for (const field of evidence.fields) supported.add(field); continue }
    const post = observations.find(item => item.id === evidence.observation_id)
    if (!post) { reasons.push('Evidence observation is missing'); continue }
    if (post.media_urls && media.filter(item => item.observation_id === post.id).length !== post.media_urls.length) reasons.push('Some source images have not been retained; resolve incomplete evidence')
    const wholeLines = requiresWholeCaptionExcerpt(evidence.fields)
    if (evidence.media_id) {
      if (!media.some(item => item.id === evidence.media_id && item.observation_id === post.id)) reasons.push('Flyer evidence is not attached to this observation')
    } else if (wholeLines) {
      if (!isWholeCaptionExcerpt(post.caption, evidence.excerpt)) reasons.push('Credit and sale-opening caption evidence must quote complete lines')
    } else if (!post.caption.includes(evidence.excerpt)) reasons.push('Caption evidence must be an exact excerpt')
    const caption = evidence.media_id ? undefined : post.caption
    if (candidate.time && evidence.fields.includes('time')) {
      if (!citesIntakeClock(evidence.excerpt, candidate.time, caption, wholeLines)) reasons.push('Start time must appear in the cited excerpt')
    }
    if (doorTime && evidence.fields.includes('doors_time') && !citesIntakeClock(evidence.excerpt, doorTime, caption, wholeLines)) {
      reasons.push('Door time must appear in the cited excerpt')
    }
    for (const field of evidence.fields) supported.add(field)
  }
  const postEvidence = candidate.evidence.filter(item => 'observation_id' in item)
  for (const field of suppliedDetailFacts(candidate)) {
    if (field === 'doors_time') {
      if (!supported.has(field)) reasons.push('Missing evidence for doors_time')
    } else if (!postEvidence.some(item => item.fields.some(value => value === field))) reasons.push(`Missing Instagram evidence for ${field}`)
  }
  for (const [field, credits] of [['organizer', candidate.organizer ? [candidate.organizer] : []], ['performers', candidate.performers ?? []]] as const) {
    for (const credit of credits) {
      if (isExcludedCreditName(credit.name, venueName)) {
        reasons.push(`A ticket seller or the venue itself cannot be credited as ${field}: ${credit.name}`)
        continue
      }
      const support = postEvidence.filter(item => item.fields.includes(field) && citesCreditName(item.excerpt, credit.name))
      if (!support.length) reasons.push(`Instagram evidence must quote the name for ${field}: ${credit.name}`)
      if (credit.url && (!validPublicUrl(credit.url) || !support.some(item => item.excerpt.includes(credit.url!)))) {
        reasons.push(`Instagram evidence must explicitly give the HTTPS URL for ${credit.name}`)
      }
    }
  }
  if (candidate.offers_valid_from) {
    const sales = new Date(candidate.offers_valid_from)
    if (!Number.isFinite(sales.getTime()) || sales.toISOString() !== candidate.offers_valid_from || sales.getUTCSeconds() !== 0 || sales.getUTCMilliseconds() !== 0) {
      reasons.push('Invalid ticket-sale opening timestamp')
    } else if (!postEvidence.some(item => item.fields.includes('offers_valid_from') && citesDateAndClock(item.excerpt, baDate(sales.toISOString()), baTime(sales.toISOString())))) {
      reasons.push('Ticket-sale opening needs the stated calendar date and time')
    }
  }
  const required = ['name', 'date', 'venue', ...(candidate.time ? ['time'] : []),
    ...(candidate.status !== 'scheduled' ? ['status'] : []), ...(candidate.price_kind !== 'unknown' ? ['price'] : []),
    ...(candidate.ticket_url ? ['ticket'] : []), ...(candidate.description_es || candidate.description_en ? ['description'] : [])]
  for (const field of required) if (!supported.has(field)) reasons.push(`Missing evidence for ${field}`)
  if (candidate.artwork_media_id && !media.some(item => item.id === candidate.artwork_media_id && observations.some(post => post.id === item.observation_id))) reasons.push('Artwork must come from the retained evidence')
  if (candidate.intent === 'create' && candidate.status !== 'scheduled') reasons.push('A cancellation or postponement needs an existing event')
  if (candidate.intent !== 'create' && !candidate.target_event_id) reasons.push('An update or link needs an existing event identity')
  if (candidate.distinct_occurrence && (!candidate.time || candidate.notes.trim().length < 20)) reasons.push('A separate showtime needs an explicit time and source-backed explanation')
  return [...new Set(reasons)]
}

/** A fuzzy match is a reason to investigate, never permission to merge. */
export function decideMatch(candidate: Candidate, catalog: CatalogMatch[], linkedIds: string[], reasons: string[]): MatchDecision {
  if (reasons.length) return { action: 'held', target: null, reasons }
  const identityIds = [...new Set([...linkedIds, ...(candidate.target_event_id ? [candidate.target_event_id] : [])])]
  if (identityIds.length > 1) return { action: 'held', target: null, reasons: [
    `Evidence points to multiple catalog events: ${identityIds.join(', ')} (already linked: ${linkedIds.join(', ') || 'none'}; target_event_id: ${candidate.target_event_id ?? 'none'})`] }
  if (identityIds.length) {
    const target = catalog.find(event => event.id === identityIds[0])
    if (!target) return { action: 'held', target: null, reasons: ['Referenced event no longer exists'] }
    return { action: candidate.intent === 'link' ? 'link' : 'update', target, reasons: [] }
  }
  const ticket = canonicalTicket(candidate.ticket_url)
  const sameTime = (event: CatalogMatch) => candidate.time !== null && !event.time_tba && new Date(event.starts_at).getTime() === new Date(candidateStart(candidate)).getTime()
  const exact = catalog.filter(event => baDate(event.starts_at) === candidate.date && (
    ticket && (canonicalTicket(event.ticket_url) === ticket || canonicalTicket(event.link) === ticket) && (candidate.time === null || sameTime(event)) ||
    event.venue_id === candidate.venue_id && normalizeTitle(event.name) === normalizeTitle(candidate.name) &&
      sameTime(event)
  ))
  if (exact.length === 1) return { action: 'link', target: exact[0], reasons: [] }
  if (exact.length > 1) return { action: 'held', target: null, reasons: ['Multiple exact catalog matches'] }
  const words = new Set(normalizeTitle(candidate.name).split(' '))
  const possible = catalog.filter(event => event.venue_id === candidate.venue_id && baDate(event.starts_at) === candidate.date &&
    !(candidate.distinct_occurrence && candidate.time && !event.time_tba && !sameTime(event)) &&
    normalizeTitle(event.name).split(' ').filter(word => words.has(word)).length / Math.max(words.size, 1) >= 0.5)
  return possible.length ? { action: 'held', target: null, reasons: ['Possible catalog duplicate; select a verified target'] }
    : { action: 'create', target: null, reasons: [] }
}
