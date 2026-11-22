import { TICKET_SELLERS } from './ticket-sellers.ts'

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const nameKey = (text: string) => fold(text).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const after = /\b(?:after(?:[ -]?part(?:y|ies))?|fiesta posterior)\b/u
const sponsorOrSales = /\b(?:entradas?|tickets?|ticketera|auspici\p{L}*|patrocin\p{L}*|con el apoyo de|sponsors?|sponsored|powered by)\b/u
const sellerNames = new Set(TICKET_SELLERS.map(domain => nameKey(domain.split('.')[0]).replaceAll(' ', '')))
const organizerLabel = /(?:^|[\n.;,–—•|])\s*(?:organiza(?:dora?)?|organizaci[oó]n|organizad[oa]\s+por|presenta|producci[oó]n|produ[cç][ei]|organized by|produced by|presented by|hosted by)\b\s*:?\s*([^\n,.;|]+)/giu
const performerLabel = /(?:^|[\n.;,–—•|])\s*(?:toca(?:n)?|act[uú]a(?:n)?|canta(?:n)?|interpreta(?:n)?|concierto de|m[uú]sica en vivo|en vivo|artistas?|line[- ]?up|dj\s+set|djs?\s*:|perform(?:s|ers)?|performed by|live music by|live)\s*:?\s+([^\n.;|]+)/giu

/** Keep the credit span, not the surrounding sales or sponsorship copy. */
export function statesCreditRole(role: 'organizer' | 'performers', name: string, excerpt: string): boolean {
  const key = nameKey(name)
  const compact = key.replaceAll(' ', '')
  if (!key || sellerNames.has(compact) || TICKET_SELLERS.some(domain => compact === domain.replaceAll('.', ''))) return false
  if (role === 'performers' && after.test(fold(excerpt))) return false
  // Remove link destinations before splitting at punctuation, but keep the displayed names.
  const text = excerpt.replace(/\[([^\]\n]+)\]\(https:\/\/[^)]+\)/gu, '$1').replace(/https:\/\/[^\s,)]+/gu, '').replace(/\*\*/g, '')
  const matches = text.matchAll(role === 'organizer' ? organizerLabel : performerLabel)
  return [...matches].some(([_, names]) => {
    if (sponsorOrSales.test(fold(names))) return false
    if (role === 'organizer') return nameKey(names) === key
    return names.split(/[,;]/u).some(part => nameKey(part.trim().replace(/\s+(?:en vivo|live)$/iu, '')) === key)
  })
}

/** An after-party heading or clause cannot be trimmed out to turn its DJ into a performer. */
export function isAfterPartyCredit(source: string, excerpt: string): boolean {
  const clean = (text: string) => fold(text).replace(/\s+/gu, ' ').trim()
  const quote = clean(excerpt)
  if (!quote) return false
  const sections: { start: number; end: number }[] = []
  let inAfterParty = false, offset = 0
  for (const raw of source.split(/\r?\n/u)) {
    const line = clean(raw)
    if (!line) { inAfterParty = false; continue }
    if (/^(?:[#*•–—-]+\s*)?(?:after(?:[ -]?party)?|fiesta posterior)\b/u.test(line)) inAfterParty = true
    else if (/^#{1,6} +\S/u.test(line) || /^[^:]+:$/u.test(line) && !/^djs?:$/u.test(line)) inAfterParty = false
    if (inAfterParty || after.test(line)) sections.push({ start: offset, end: offset + line.length })
    offset += line.length + 1
  }
  const text = clean(source)
  for (let start = text.indexOf(quote); start !== -1; start = text.indexOf(quote, start + 1)) {
    if (sections.some(section => section.end > start && section.start < start + quote.length)) return true
  }
  return false
}
