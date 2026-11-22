import { TICKET_SELLERS } from './ticket-sellers.ts'

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
const sellerNames = new Set(TICKET_SELLERS.flatMap(domain => [domain, domain.split('.')[0]]))

export function isExcludedCreditName(name: string, venueName?: string | null): boolean {
  const key = fold(name)
  return sellerNames.has(key) || (venueName != null && key === fold(venueName))
}

/** Check the spelling, not the role. The operator or extraction model interprets the quote. */
export function citesCreditName(excerpt: string, name: string): boolean {
  const key = fold(name)
  if (!key) return false
  return new RegExp(String.raw`(?<![\p{L}\p{N}])${RegExp.escape(key)}(?![\p{L}\p{N}])`, 'u').test(fold(excerpt))
}
