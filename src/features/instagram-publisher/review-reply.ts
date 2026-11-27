import { NEIGHBORHOODS } from '#shared/lib/types.ts'
import { slackLiteral } from './alerts.ts'
import type { FixReceipt } from './catalog-fix.ts'
import type { RecordedCheck } from './investigation.ts'
import type { ReviewEvidenceFlag } from './review.ts'
import type { ReviewResources } from './review-evidence.ts'

export interface ReviewPartReceipt { id: string; since: number }
export interface ReviewReplyDelivery {
  channel: string
  threadTs: string | null
  parts: string[]
  parent?: ReviewPartReceipt
  inFlight?: ReviewPartReceipt
}

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

// Keywords locate snippets and classify legacy flags; they never establish a fact or verdict.
const claimFields = [
  ['barrio', /\b(barrio|neighbou?rhood)\b/iu, ['venue'], /\b(?:barrio|comuna)\b/iu],
  ['address', /\b(address|direcci[oó]n|ubicaci[oó]n|location)\b/iu, ['venue'], /\b(?:avenida|av\.?|calle|pasaje|direcci[oó]n)\b/iu],
  ['price', /\b(price|free|paid|payment|admission|gratis|gratuit[ao]s?|precio|arancel|gorra)\b/iu, ['price'], /\b(?:gratis|gratuit[ao]s?|free|precio|arancel|gorra|sin (?:cargo|costo)|(?:entrada|ingreso|acceso|admisión) libre|ARS|pesos)\b|\$\s*\d/iu],
  ['doors_time', /\b(doors|puertas)\b/iu, ['doors_time'], /\b(?:puertas|ingreso|apertura|doors)\b/iu],
  ['time', /\b(time|start(?:s)?|hora|horario)\b/iu, ['time'], /\b\d{1,2}(?:[:.]\d{2}|\s*h(?:s|oras)?\b)/iu],
  ['date', /\b(date|day|d[ií]a|fecha)\b/iu, ['date'], /\b(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|\d{1,2}\/\d{1,2})\b/iu],
  ['ticket', /\b(tickets?|booking|reservation|reserva|entradas?)\b/iu, ['ticket'], /\b(?:entradas?|inscripci[oó]n|reserv[aeá]|boletos?)\b/iu],
  ['venue', /\b(venue|lugar|sede)\b/iu, ['venue'], /\b(?:sede|direcci[oó]n|avenida|av\.?|calle|lugar|centro cultural|teatro|sala|museo)\b/iu],
  ['name', /\b(name|title|nombre|t[ií]tulo)\b/iu, ['name'], /\b(?:nombre|t[ií]tulo)\b/iu],
  ['description', /\b(description|summary|scope|descripci[oó]n|category)\b/iu, ['description'], /\b(?:sinopsis|descripci[oó]n)\b/iu],
  ['status', /\b(status|cancel(?:led|ed|lation)|postponed)\b/iu, ['status'], /\b(?:cancelad[oa]|suspendid[oa]|reprogramad[oa])\b/iu],
  ['organizer', /\b(organizers?|organizaci[oó]n)\b/iu, ['organizer'], /\b(?:organiz[an]|organizaci[oó]n)\b/iu],
  ['performers', /\b(performers?|artists?|handle|credit)\b/iu, ['performers'], /\b(?:artistas?|elenco|m[uú]sicos?)\b/iu],
] as const

export function reviewClaim(field: string | null, detail: string) {
  if (!field && /\b(?:show|start) time\b/iu.test(detail)) return claimFields.find(([key]) => key === 'time')
  return claimFields.find(([key]) => field === key) ?? claimFields.find(([, label]) => label.test(field?.replaceAll('_', ' ') ?? detail))
}

export const matchesEvidenceField = (claim: ReturnType<typeof reviewClaim>, fields: string[]) =>
  Boolean(claim?.[2].some(field => fields.includes(field)))

function quote(value: string, hint?: RegExp) {
  const trimmed = value.trim().replace(/https?:\/\/[^\s<>|"“”]+/giu, url => slackLink(url) ? url : '[link omitted]')
  if (trimmed.length <= 200) return `“${slackLiteral(trimmed, 'quote')}”`
  const offset = hint ? trimmed.search(hint) : -1
  const start = Math.max(0, offset - 50)
  return `${start ? '…' : ''}“${slackLiteral(trimmed.slice(start, start + 200).trim(), 'quote')}”${start + 200 < trimmed.length ? '…' : ''}`
}

const normalizeAddress = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/\s+/gu, ' ')
const numberedStreet = String.raw`([\p{L}\d][\p{L}\p{M}\d.'’ -]{1,79}?)\s*,?\s+(?:(?:n[°º]|nro\.?|#)\s*)?([1-9]\d{0,4})(?![\d:])`
const markedAddress = new RegExp(String.raw`\b(Av\.?|Avenida|Calle|Pasaje|Pje\.?|Direcci[oó]n\s*:)\s+${numberedStreet}`, 'giu')

function addressParts(text: string, allowBare: boolean) {
  const normalize = (street: string, height: string) => ({ street: normalizeAddress(street)
    .replace(/^DIRECCION\s*:\s*/u, '').replace(/^CALLE /u, '')
    .replace(/^(?:AV\.?|AVENIDA) (.+)$/u, '$1 AV.').replace(/ AV$/u, ' AV.'), height })
  const matches = [...text.matchAll(markedAddress)].map(([, marker, street, height]) => normalize(`${marker} ${street}`, height!))
  if (matches.length || !allowBare) return matches
  const [first] = text.trim().replace(/,(?=\s*\d)/u, ' ').split(/[,\n·|–—]/u)
  const match = first?.match(new RegExp(`^${numberedStreet}$`, 'iu'))
  return match ? [normalize(match[1]!, match[2]!)] : []
}

export interface ReviewBarrioLookup { url: string; address: string; barrio: string | null; ambiguous?: boolean }

export const isAddressFlag = (flag: ReviewEvidenceFlag, detail: string) => ['barrio', 'address', 'venue'].some(key => reviewClaim(flag.field, detail)?.[0] === key)

export async function lookupReviewBarrio(evidence: ReviewResources | undefined, fetchImpl: typeof fetch = fetch, question = ''): Promise<ReviewBarrioLookup | null> {
  const cited = [...(evidence?.observations.flatMap(observation => observation.excerpts) ?? []), ...(evidence?.officialPages ?? [])]
    .filter(entry => entry.fields.includes('venue')).map(entry => entry.excerpt)
  const supported = [evidence?.address ?? '', ...cited].flatMap(value => addressParts(value, true))
    .concat((evidence?.observations ?? []).flatMap(item => addressParts(item.caption, false)))
  const parts = supported[0]
  if (!parts) return null
  // An avenue and a street with the same name can be different streets in CABA.
  const ambiguous = [...supported, ...addressParts(question, false)].some(item => item.street !== parts.street || item.height !== parts.height)
  const url = `https://ws.usig.buenosaires.gob.ar/datos_utiles?calle=${encodeURIComponent(parts.street)}&altura=${parts.height}`
  const lookup: ReviewBarrioLookup = { url, address: `${parts.street} ${parts.height}`, barrio: null, ...(ambiguous ? { ambiguous } : {}) }
  try {
    const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(4_000) })
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      return lookup
    }
    const result: unknown = await response.json()
    if (result && typeof result === 'object' && 'barrio' in result && typeof result.barrio === 'string') {
      const barrio = result.barrio.trim()
      if (NEIGHBORHOODS.some(name => normalizeAddress(name) === normalizeAddress(barrio))) lookup.barrio = barrio
    }
  } catch { /* Show the link even if the official service is unavailable. */ }
  return lookup
}

function barrioLine(lookup: ReviewBarrioLookup | null) {
  if (!lookup) return 'USIG: no se pudo identificar una calle y altura.'
  const link = slackLink(lookup.url, `USIG: ${slackLiteral(lookup.address)}`)
  const result = lookup.barrio ? `${link} — barrio oficial: ${slackLiteral(lookup.barrio)}.` : `${link} — falló la consulta oficial.`
  return lookup.ambiguous ? `${result} Las fuentes no coinciden en la dirección.` : result
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

export function eventResourceLines(id: string, flag: ReviewEvidenceFlag, detail: string, evidence: ReviewResources | undefined, lookup: ReviewBarrioLookup | null) {
  const lines = [`<https://baeventos.com/events/${encodeURIComponent(id)}|Evento en BA Eventos>`]
  const claim = reviewClaim(flag.field, detail)
  const addressFlag = isAddressFlag(flag, detail)
  const snippet = (text: string) => text.split(/\r?\n/u).map(line => line.trim()).find(line =>
    line && (claim?.[3].test(line) || (addressFlag && addressParts(line, false).length)))
  const sources = new Map<string, { label: string; tagged?: string; caption?: string; context?: string }>()
  for (const observation of evidence?.observations ?? []) {
    const link = slackLink(observation.postUrl)
    if (!link) continue
    const source = sources.get(link) ?? { label: 'Fuente' }
    source.tagged ??= observation.excerpts.find(entry => matchesEvidenceField(claim, entry.fields))?.excerpt
    source.caption ??= snippet(observation.caption)
    sources.set(link, source)
  }
  for (const page of evidence?.officialPages ?? []) {
    const link = slackLink(page.url)
    if (!link) continue
    const source = sources.get(link) ?? { label: 'Página oficial' }
    if (matchesEvidenceField(claim, page.fields)) source.tagged ??= page.excerpt
    else source.caption ??= snippet(page.excerpt)
    source.context ??= page.excerpt
    sources.set(link, source)
  }
  for (const [link, { label, tagged, caption, context }] of sources) {
    const relevant = tagged || caption
    const excerpt = relevant || context
    const note = relevant ? '' : 'Sin cita sobre este dato.'
    lines.push([`${label}: ${link}`, note, excerpt ? quote(excerpt, claim?.[3]) : ''].filter(Boolean).join('\n'))
  }
  if (!evidence) lines.push('No se pudo cargar la evidencia del catálogo.')
  if (addressFlag) lines.push(barrioLine(lookup))
  return lines
}

export function eventReplyLines(item: ReviewEventReply, evidence: ReviewResources | undefined, fixes: FixReceipt[], lookup: ReviewBarrioLookup | null) {
  const lines = [withLinks(`${item.title}: ${item.detail}`), ...eventResourceLines(item.id, item.flag,
    item.flag.question ?? item.flag.reason ?? item.detail, evidence, lookup)]
  const checks = (item.checks ?? []).flatMap(check => checkText(check, fixes).flatMap(text => text ? [`Checked (r${check.revision}): ${withLinks(text)}`] : []))
  lines.push(...(checks.length ? [...new Set(checks)] : [`Not investigated: ${slackLiteral(item.notInvestigated)}`]))
  return lines
}

/** Slack recommends 4,000 characters. Split on resource lines, leaving room for permalink and quote formatting. */
export function splitReviewReply(lines: string[], prefix = '', quoteNotice = false) {
  const parts: string[] = []
  let current = prefix
  for (const line of lines) {
    const formatted = quoteNotice ? line.split('\n').map(item => `> ${item}`).join('\n') : line
    if (current.length + 1 + formatted.length > 4_000) {
      parts.push(current)
      current = quoteNotice ? '> Revisión: continuación' : 'Revisión: continuación'
    }
    current += `${current ? '\n' : ''}${formatted}`
  }
  parts.push(current)
  return parts
}
