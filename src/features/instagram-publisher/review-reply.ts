import { NEIGHBORHOODS } from '#shared/lib/types.ts'
import { slackLiteral } from './alerts.ts'
import type { FixReceipt } from './catalog-fix.ts'
import type { RecordedCheck } from './investigation.ts'
import type { ReviewEvidenceFlag } from './review.ts'
import type { ReviewResources } from './review-evidence.ts'
import type { QuestionEvidence, ReviewSelection, VenueAddress } from './review-resolution.ts'

export interface ReviewPartReceipt { id: string; since: number }
export interface ReviewReplyDelivery {
  channel: string
  threadTs: string | null
  parts: string[]
  /** An uncertain first notice can be reconciled, but never sent again. */
  firstDecision?: { text: string; receipt: ReviewPartReceipt; broadcast: boolean }
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
export function withReviewLinks(value: string) {
  return value.split(/(https?:\/\/[^\s<>|"“”]+)/giu).map((part, index) => {
    if (index % 2 === 0) return slackLiteral(part)
    const url = part.replace(/[),.;!?]+$/u, '')
    return `${slackLink(url) ?? '[link omitted]'}${slackLiteral(part.slice(url.length))}`
  }).join('')
}

function quote(value: string) {
  const chars = Array.from(value.trim().replace(/https?:\/\/[^\s<>|"“”]+/giu, url => slackLink(url) ? url : '[link omitted]'))
  return `“${slackLiteral(chars.slice(0, 200).join('').trim(), 'quote')}”${chars.length > 200 ? '…' : ''}`
}

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/\s+/gu, ' ')
export const streetForUsig = (street: string) => fold(street).replace(/^CALLE /u, '').replace(/^(?:AV\.?|AVDA\.?|AVENIDA) (.+)$/u, '$1 AV.').replace(/ AV$/u, ' AV.')

export interface ReviewBarrioLookup { url: string; address: string; barrio: string | null; status: 'checked' | 'unavailable' }

export async function lookupReviewBarrio(address: VenueAddress, fetchImpl: typeof fetch = fetch): Promise<ReviewBarrioLookup> {
  const street = streetForUsig(address.street)
  const url = `https://ws.usig.buenosaires.gob.ar/datos_utiles?calle=${encodeURIComponent(street)}&altura=${address.number}`
  const lookup: ReviewBarrioLookup = { url, address: `${street} ${address.number}`, barrio: null, status: 'unavailable' }
  try {
    const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(4_000) })
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      return lookup
    }
    const result: unknown = await response.json()
    if (result && typeof result === 'object' && 'barrio' in result && (typeof result.barrio === 'string' || result.barrio === null)) {
      lookup.status = 'checked'
      const barrio = result.barrio?.trim()
      if (barrio && NEIGHBORHOODS.some(name => fold(name) === fold(barrio))) lookup.barrio = barrio
    }
  } catch { /* Show the link even if the official service is unavailable. */ }
  return lookup
}

function barrioLine({ lookup, conflictingAddresses }: ReviewSelection) {
  if (conflictingAddresses) return 'USIG: las fuentes no coinciden en la dirección del evento.'
  if (!lookup) return 'USIG: ninguna fuente confirmó la calle y altura del lugar del evento.'
  const link = slackLink(lookup.url, `USIG: ${slackLiteral(lookup.address)}`)
  if (lookup.status === 'unavailable') return `${link} — falló la consulta oficial.`
  return lookup.barrio ? `${link} — barrio oficial: ${slackLiteral(lookup.barrio)}.` : `${link} — la consulta no confirmó el barrio.`
}

function checkText({ finding }: RecordedCheck, fixes: FixReceipt[]) {
  if (finding.verdict === 'ask') return [finding.checked]
  if (finding.verdict === 'ok') return [`${finding.reason} (${finding.url})`, finding.checked]
  // The investigator may cite the correction in the instruction to Hermes, with or without a checked note.
  if (finding.verdict === 'exclude') return [finding.reason, finding.checked, finding.hermes]
  return [finding.checked, ...fixes.filter(fix => finding.fixes.includes(fix.operation)).map(fix => fix.evidence)]
}

export function recordedCheckLines(checks: RecordedCheck[], fixes: FixReceipt[]) {
  return [...new Set(checks.flatMap(check => checkText(check, fixes).flatMap(text => text ? [`Checked (r${check.revision}): ${withReviewLinks(text)}`] : [])))]
}

export interface ReviewEventReply {
  id: string
  title: string
  detail: string
  flag: ReviewEvidenceFlag
  notInvestigated: string
  checks?: RecordedCheck[]
  record?: QuestionEvidence
}

export function sourceReadings(evidence: ReviewResources | undefined, selection?: ReviewSelection, research: Array<{ url: string; excerpt: string }> = []) {
  const sources = new Map<string, { label: string; caption?: string; excerpt?: string }>()
  for (const observation of evidence?.observations ?? []) {
    if (!publicReviewUrl(observation.postUrl)) continue
    const source = sources.get(observation.postUrl) ?? { label: 'Fuente' }
    source.caption ||= observation.caption.trim()
    source.excerpt ||= observation.excerpts.find(entry => entry.excerpt.trim())?.excerpt
    sources.set(observation.postUrl, source)
  }
  for (const page of evidence?.officialPages ?? []) {
    if (!publicReviewUrl(page.url)) continue
    const source = sources.get(page.url) ?? { label: 'Página oficial' }
    source.excerpt ||= page.excerpt.trim()
    sources.set(page.url, source)
  }
  for (const { url, excerpt } of research) {
    if (publicReviewUrl(url) && !sources.has(url)) sources.set(url, { label: 'Fuente de la investigación', excerpt })
  }
  return [...sources].map(([url, { label, caption, excerpt }]) => ({ url, label, quote:
    selection?.quotes.find(item => item.url === url)?.quote ?? (caption || excerpt)?.trim().slice(0, 400) ?? null }))
}

export function eventResourceLines(id: string, evidence: ReviewResources | undefined, selection?: ReviewSelection, record?: QuestionEvidence) {
  const lines = [`<https://baeventos.com/events/${encodeURIComponent(id)}|Evento en BA Eventos>`]
  const readings = record?.sources ?? sourceReadings(evidence, selection)
  for (const source of readings) {
    lines.push(`${source.label}: ${slackLink(source.url)}\n${source.quote ? quote(source.quote) : 'Sin texto en esta fuente.'}`)
  }
  if (!record && !evidence) lines.push('No se pudo cargar la evidencia del catálogo.')
  if (record?.state === 'complete' && !record.conclusion) {
    const why = !readings.length ? 'No hay fuentes públicas vinculadas.' : selection?.conflictingAddresses
      ? 'Las fuentes no coinciden en el lugar de la función.' : 'Las fuentes consultadas no permiten confirmar el dato para esta función.'
    lines.push(`Por qué sigue abierta la pregunta: ${why}`)
  }
  if (selection && selection.topic !== 'other') lines.push(barrioLine(selection))
  return lines
}

export function eventReplyLines(item: ReviewEventReply, evidence: ReviewResources | undefined, fixes: FixReceipt[], selection?: ReviewSelection) {
  const { record } = item
  const lines = [withReviewLinks(`${item.title}: ${item.detail}`), ...eventResourceLines(item.id, evidence, record ?? selection, record)]
  const checks = recordedCheckLines([...(record?.history ?? []), ...(item.checks ?? [])], fixes)
  lines.push(...(checks.length ? checks : [`Not investigated: ${slackLiteral(item.notInvestigated)}`]))
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
