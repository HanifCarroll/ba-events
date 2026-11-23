import { TICKET_SELLERS } from './ticket-sellers.ts'

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
const sellerKey = (text: string) => fold(text).replace(/[^\p{L}\p{N}]/gu, '')
// The first domain label also covers display names such as Alternativa Teatral and Tu Entrada.
const sellerNames = new Set(TICKET_SELLERS.flatMap(domain => [sellerKey(domain), sellerKey(domain.split('.')[0])]))

export function isExcludedCreditName(name: string, venueName?: string | null): boolean {
  return sellerNames.has(sellerKey(name)) || (venueName != null && fold(name) === fold(venueName))
}

/** Check the spelling, not the role. The operator or extraction model interprets the quote. */
export function citesCreditName(excerpt: string, name: string): boolean {
  const key = fold(name)
  if (!key) return false
  return new RegExp(String.raw`(?<![\p{L}\p{N}])${RegExp.escape(key)}(?![\p{L}\p{N}])`, 'u').test(fold(excerpt))
}
