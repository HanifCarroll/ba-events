/**
 * What makes two catalog venues the same: their normalized name, their street and number, and which copy to keep.
 * Shared by the importers' matcher and `scripts/venue-duplicates.ts`, so matching and the duplicate merge agree.
 */

/** Clean a source's trailing venue/address separator without changing dashes within the name. */
export const trimVenueName = (name: string) => name.trimStart().replace(/[\s—–-]+$/u, '')

// Accented letters in the catalog's names, dashes, and the non-breaking space. Upper case maps straight to lower case so
// SQL never depends on the database locale. `public.venue_name_key` in 20261116180000_venue_name_matching.sql uses
// these exact two strings; a test keeps them equal.
export const NAME_FOLD_FROM = 'ÁÀÂÄÃÅáàâäãåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÖÕóòôöõÚÙÛÜúùûüÑñÇçÝýÿ–—\u00a0'
export const NAME_FOLD_TO = 'aaaaaaaaaaaaeeeeeeeeiiiiiiiioooooooooouuuuuuuunnccyyy-- '
const FOLD = new Map([...NAME_FOLD_FROM].map((char, index) => [char, NAME_FOLD_TO[index]]))

/**
 * The name venues must share to count as the same name: case, accents, every kind of whitespace (non-breaking spaces
 * included) and punctuation folded, and trailing "- Buenos Aires", "- CABA" and "- Argentina" dropped. "Teatro  Ópera —"
 * and "teatro opera - CABA" both give "teatro opera". Mirrors `public.venue_name_key` step for step.
 */
export function venueNameKey(name: string): string {
  return [...name.normalize('NFC')].map(char => FOLD.get(char) ?? char).join('').toLowerCase()
    .replace(/[^a-z0-9-]+/g, ' ')
    .replace(/( *- *(buenos aires|caba|argentina))+[ -]*$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/**
 * Street name plus house number, so the catalog's messy formats compare equal: "Av. Corrientes N° 1530 - C.A.B.A.",
 * "Avenida Corrientes 1530, C1043AAB" and "Corrientes 1530" all give "corrientes 1530". The house number must follow
 * the street name, so "3 de Febrero" or "Av. 9 de Julio" alone has no key while "3 de Febrero 1378" does.
 */
export function addressKey(address: string | null | undefined): string | null {
  if (!address) return null
  const normalize = (value: string) => fold(value) // "N°" folds to "n°", so markers are matched after folding
    .replace(/\b(cp\s*)?[a-z]\d{4}[a-z]{0,3}\b|\bcp\s*\d{4}\b/g, ' ') // postal codes: C1043AAB, C1043, CP 1043
    .replace(/\b(numero|nro|num|n)\s*[.°º]*\s*(?=\d)/g, ' ') // number markers: N° 1530, nro. 1530
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\b(ciudad autonoma de buenos aires|cdad autonoma de buenos aires|ciudad de buenos aires|capital federal|c a b a|caba|buenos aires|argentina)\b/g, ' ')
    .replace(/\s+/g, ' ').trim()
  const plain = normalize(address)
  const street = (value: string) => value.replace(/^(avenida|avda|av|calle|pasaje|pje)\s+/, '')
  const parts = street(plain).match(/^(.*?\p{L}.*?)\s(\d{1,5})\b/u)
  if (parts) return `${parts[1]} ${parts[2]}`
  // Number first, as some ticket sites write it: "1660 Avenida Corrientes". "25 de Mayo" is a street name, not this.
  const first = normalize(address.split(',')[0]).match(/^(\d{1,5})\s(?!de\b)(\p{L}[\p{L} ]*)$/u)
  return first ? `${street(first[2])} ${first[1]}` : null
}

export interface VenueCopy {
  id: string
  address: string | null
  neighborhood: string | null
  created_at: string
  event_count: number
}

// A numbered address outranks a barrio, which breaks ties between equal addresses.
const completeness = (venue: VenueCopy) => (addressKey(venue.address) ? 4 : venue.address?.trim() ? 2 : 0) + (venue.neighborhood ? 1 : 0)

/** Which same-name copy to keep: the most complete address and barrio, then the most events, then the oldest. */
export function keeperOrder(a: VenueCopy, b: VenueCopy): number {
  return completeness(b) - completeness(a) || b.event_count - a.event_count ||
    a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
}

/**
 * One venue out of several that share a normalized name. With a numbered address, a copy at another street and number
 * is another place and never picked: the same street and number wins (the rule PR #48 set for barrio names), then a copy
 * with no numbered address. Among those, and always when the event has no numbered address, the merge keeper wins, so
 * matching and merging agree. Null when nothing fits.
 */
export function pickVenue<T extends VenueCopy>(venues: readonly T[], address?: string | null): T | null {
  const key = addressKey(address)
  if (!key) return [...venues].sort(keeperOrder)[0] ?? null
  const here = venues.filter(venue => addressKey(venue.address) === key)
  const unknown = venues.filter(venue => !addressKey(venue.address))
  return [...(here.length ? here : unknown)].sort(keeperOrder)[0] ?? null
}
