import { slackLiteral } from './alerts.ts'
import type { FixReceipt } from './catalog-fix.ts'
import type { RecordedCheck } from './investigation.ts'
import type { ReviewEvidenceFlag } from './review.ts'
import type { ReviewResources } from './review-evidence.ts'

export interface ReviewReplyDelivery { channel: string; threadTs: string; parts: string[] }

// Keep the rendered destination intact, but do not republish credentials or private signed links.
export function publicReviewUrl(value: string) {
  if (value.length > 2048 || /[<>|\s]/u.test(value)) return false
  const url = URL.parse(value)
  return !!url && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password &&
    !/(?:^|[?&#])[^=&?#]*(?:token|secret|password|signature|credential|api[_-]?key)[^=&?#]*=/iu.test(decodeURIQuery(url))
}

function slackLink(value: string, label?: string) {
  return publicReviewUrl(value) ? `<${value.replaceAll('&', '&amp;')}${label ? `|${label}` : ''}>` : null
}

function decodeURIQuery(url: URL) {
  try { return decodeURIComponent(`${url.search}${url.hash}`) } catch { return `${url.search}${url.hash}` }
}

/** Findings are prose. Render only individually validated public URLs as links, not Slack markup from the investigator. */
function withLinks(value: string) {
  return value.split(/(https?:\/\/[^\s<>|"“”]+)/giu).map((part, index) => {
    if (index % 2 === 0) return slackLiteral(part)
    const url = part.replace(/[),.;!?]+$/u, '')
    return `${slackLink(url) ?? '[link omitted]'}${slackLiteral(part.slice(url.length))}`
  }).join('')
}

const claimFields = [
  [/\b(barrio|neighbou?rhood|address|direcci[oó]n|ubicaci[oó]n|location)\b/iu, ['venue']],
  [/\b(price|free|paid|payment|admission|gratis|gratuit[ao]s?|precio|arancel|a la gorra|is_free)\b/iu, ['price', 'ticket']],
  [/\b(time|doors|start|hora|horario|doors_time|starts_at)\b/iu, ['time', 'doors_time']],
  [/\b(date|day|d[ií]a|fecha)\b/iu, ['date']],
  [/\b(ticket|booking|reservation|reserva|entrada)\b/iu, ['ticket', 'price']],
  [/\b(venue|lugar|sede)\b/iu, ['venue']],
  [/\b(name|title|t[ií]tulo)\b/iu, ['name']],
  [/\b(description|summary|scope|descripci[oó]n|category)\b/iu, ['description', 'name']],
  [/\b(status|cancel(?:led|ed|lation)|postponed)\b/iu, ['status']],
  [/\b(organizer|performers?|artist|handle|credit)\b/iu, ['organizer', 'performers']],
] as const

function claim(flag: ReviewEvidenceFlag, detail: string) {
  // Older quick-review questions had no field. Use the question text only when the saved verdict didn't specify one.
  return claimFields.find(([pattern]) => pattern.test(flag.field ?? detail))
}

function quote(value: string, hint?: RegExp) {
  const trimmed = value.trim().replace(/https?:\/\/[^\s<>|"“”]+/giu, url => slackLink(url) ? url : '[link omitted]')
  if (trimmed.length <= 200) return `“${slackLiteral(trimmed, 'quote')}”`
  const offset = hint ? trimmed.search(hint) : -1
  const start = Math.max(0, offset - 50)
  return `${start ? '…' : ''}“${slackLiteral(trimmed.slice(start, start + 200).trim(), 'quote')}”${start + 200 < trimmed.length ? '…' : ''}`
}

function addressParts(value: string) {
  // Accept a numbered street, not a free-form paragraph, floor number, or intersection.
  const [first] = value.trim().replace(/,(?=\s*\d)/u, ' ').split(/[,\n·|–—]/u)
  const match = first?.match(/^(?:direcci[oó]n\s*:\s*)?([\p{L}\d][\p{L}\p{M}\d.'’ -]{1,79}?)\s+(?:(?:n[°º]|nro\.?|#)\s*)?([1-9]\d{0,4})\s*$/iu)
  if (!match) return null
  const street = match[1]!.normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/gu, ' ').toUpperCase()
    .replace(/^(?:AV\.?|AVENIDA) (.+)$/u, '$1 AV.').replace(/ AV$/u, ' AV.')
  return { street, height: match[2]! }
}

export interface ReviewBarrioLookup { url: string; address: string; barrio: string | null }

export const isAddressFlag = (flag: ReviewEvidenceFlag, detail: string) => claim(flag, detail)?.[1].some(field => field === 'venue') ?? false

export async function lookupReviewBarrio(evidence: ReviewResources | undefined, fetchImpl: typeof fetch = fetch): Promise<ReviewBarrioLookup | null> {
  const cited = [...(evidence?.observations.flatMap(observation => observation.excerpts) ?? []), ...(evidence?.officialPages ?? [])]
    .filter(entry => entry.fields.includes('venue')).map(entry => entry.excerpt)
  const parts = [evidence?.address ?? '', ...cited].map(addressParts).find(Boolean)
  if (!parts) return null
  const url = `https://ws.usig.buenosaires.gob.ar/datos_utiles?calle=${encodeURIComponent(parts.street)}&altura=${parts.height}`
  const lookup: ReviewBarrioLookup = { url, address: `${parts.street} ${parts.height}`, barrio: null }
  try {
    const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(4_000) })
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      return lookup
    }
    const result: unknown = await response.json()
    if (result && typeof result === 'object' && 'barrio' in result && typeof result.barrio === 'string' && result.barrio.trim() && result.barrio.length <= 100) {
      lookup.barrio = result.barrio.trim()
    }
  } catch { /* Show the link even if the official service is unavailable. */ }
  return lookup
}

function barrioLine(lookup: ReviewBarrioLookup | null) {
  if (!lookup) return 'USIG: no se pudo identificar una calle y altura.'
  const link = slackLink(lookup.url, `USIG: ${slackLiteral(lookup.address)}`)
  return lookup.barrio ? `${link} — barrio oficial: ${slackLiteral(lookup.barrio)}.` : `${link} — falló la consulta oficial.`
}

function checkText({ finding }: RecordedCheck, fixes: FixReceipt[]) {
  if (finding.verdict === 'ask') return [finding.checked]
  if (finding.verdict === 'ok') return [`${finding.reason} (${finding.url})`, finding.checked]
  if (finding.verdict === 'exclude') return [finding.checked ?? finding.hermes ?? finding.reason]
  return [finding.checked, ...fixes.filter(fix => finding.fixes.includes(fix.operation)).map(fix => fix.evidence)]
}

export interface ReviewEventReply {
  id: string
  title: string
  detail: string
  flag: ReviewEvidenceFlag
  notInvestigated: string
  checks?: RecordedCheck[]
}

export function eventReplyLines(item: ReviewEventReply, evidence: ReviewResources | undefined, fixes: FixReceipt[], lookup: ReviewBarrioLookup | null) {
  const lines = [withLinks(`${item.title}: ${item.detail}`), `<https://baeventos.com/events/${encodeURIComponent(item.id)}|Evento en BA Eventos>`]
  const [hint, fields] = claim(item.flag, item.flag.question ?? item.flag.reason ?? item.detail) ?? []
  const relevant = (entry: { fields: string[] }) => !fields || entry.fields.some(field => fields.some(wanted => field === wanted))
  const posts = new Map<string, string[]>()
  const pages = new Map<string, string[]>()
  for (const observation of evidence?.observations ?? []) {
    const link = slackLink(observation.postUrl)
    if (!link) continue
    const excerpts = observation.excerpts.filter(relevant).map(entry => entry.excerpt)
    posts.set(link, [...(posts.get(link) ?? []), ...excerpts])
  }
  for (const page of evidence?.officialPages ?? []) {
    const link = slackLink(page.url)
    if (!link) continue
    if (!pages.has(link)) pages.set(link, [])
    // Prefer a field citation, but include a page excerpt when the page only supports another fact.
    if (relevant(page)) pages.get(link)!.unshift(page.excerpt)
    else pages.get(link)!.push(page.excerpt)
  }
  const selected = new Map<string, string[]>()
  const seen = new Set<string>()
  function select(group: Map<string, string[]>, limit = 2, repeat = false) {
    for (const [link, excerpts] of group) {
      if (seen.size >= limit) return
      if (!repeat && selected.has(link)) continue
      const next = excerpts.find(excerpt => excerpt.trim() && !seen.has(excerpt.trim()))
      if (!next) continue
      seen.add(next.trim())
      selected.set(link, [...(selected.get(link) ?? []), next])
    }
  }
  // First show both types of source when possible, then favor excerpts from different links.
  select(posts, 1)
  select(pages)
  select(posts)
  select(posts, 2, true)
  select(pages, 2, true)
  for (const [label, links] of [['Fuente', posts], ['Página oficial', pages]] as const) {
    for (const link of links.keys()) {
      lines.push(`${label}: ${link}`)
      for (const excerpt of selected.get(link) ?? []) lines.push(quote(excerpt, hint))
    }
  }
  if (!evidence) lines.push('No se pudo cargar la evidencia del catálogo.')
  if (isAddressFlag(item.flag, item.flag.question ?? item.flag.reason ?? item.detail)) lines.push(barrioLine(lookup))
  const checks = (item.checks ?? []).flatMap(check => checkText(check, fixes).flatMap(text => text ? [`Checked (r${check.revision}): ${withLinks(text)}`] : []))
  lines.push(...(checks.length ? [...new Set(checks)] : [`Not investigated: ${slackLiteral(item.notInvestigated)}`]))
  return lines
}

/** Slack recommends 4,000 characters. Split on resource lines, leaving room for permalink and quote formatting. */
export function splitReviewReply(lines: string[], prefix = '', quoteNotice = false) {
  const parts: string[] = []
  let current = prefix
  for (const line of lines) {
    const formatted = quoteNotice ? `> ${line}` : line
    if (current.length + 1 + formatted.length > 4_000) {
      parts.push(current)
      current = quoteNotice ? '> Revisión: continuación' : 'Revisión: continuación'
    }
    current += `${current ? '\n' : ''}${formatted}`
  }
  parts.push(current)
  return parts
}
