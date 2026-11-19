import { Effect, Schema } from 'effect'
import { NEIGHBORHOODS } from '#shared/lib/types.ts'
import { addressKey as catalogAddressKey } from '../core/venue-identity.ts'

export const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
// Exact barrio names only: the importers' partial matching would turn "Villa" into Villa Crespo.
export const barrio = (given: string) => NEIGHBORHOODS.find(item => fold(item) === fold(given.trim())) ?? null

/** Keep the avenue type distinct from a plain street, except for the known Diagonal Norte alias. */
export function addressKey(address: string | null | undefined): string | null {
  if (!address) return null
  const suffix = /\s+av\.(?=\s+\d)/i
  const avenue = /^(?:\d+\s+)?(?:av(?:da)?\.|(?:av(?:da)?|avenida)\s)/i.test(address.trim()) || suffix.test(address)
  const key = catalogAddressKey(address.replace(suffix, ''))
  if (!key) return null
  if (/^diagonal norte \d+$/.test(key) || avenue && /^(?:(?:presidente )?roque saenz pena|saenz pena roque pres diagonal norte) \d+$/.test(key)) {
    return `avenida diagonal norte ${key.split(' ').at(-1)}`
  }
  return avenue ? `avenida ${key.replace(/^presidente sarmiento (?=\d+$)/, 'sarmiento ')}` : key
}

const words = (text: string) => fold(text).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const cityLabel = 'caba|c a b a|capital federal|(?:ciudad|cdad)(?: autonoma)? de buenos aires'
const citySuffix = new RegExp(`^(?:${cityLabel})$`)
const cityEvidence = new RegExp(`\\b(?:${cityLabel}|${NEIGHBORHOODS.map(words).join('|')})\\b`)

/** Keep unknown localities out of the municipal fallback; USIG expects the city suffix as ", CABA". */
export function municipalAddress(address: string, height: string, evidence: readonly { confirms: string }[]) {
  const numbered = new RegExp(`^(.*?\\s${height})(?=$|[\\s,–—-])(.*)$`).exec(address)
  if (!numbered) return null
  const qualifiers = numbered[2].split(/[,–—-]/).map(words).filter(label => label && !/^(?:argentina|c\d{4}[a-z]{0,3})$/.test(label))
  if (qualifiers.some(label => !citySuffix.test(label) && !barrio(label))) return null
  const explicit = qualifiers.length > 0 || evidence.some(item => cityEvidence.test(words(item.confirms)))
  return { explicit, query: explicit ? `${numbered[1]}, CABA` : numbered[1], neighborhood: qualifiers.map(barrio).find(Boolean) ?? null }
}

const usigAddresses = Schema.Struct({ direccionesNormalizadas: Schema.Array(Schema.Struct({
  cod_partido: Schema.String, cod_calle: Schema.Number, nombre_calle: Schema.String, altura: Schema.NullOr(Schema.Number),
})) })
const usigArea = Schema.Struct({ barrio: Schema.String })
const MAX_USIG_BYTES = 256 * 1024

async function readUsig(base: string, params: Record<string, string>): Promise<unknown> {
  const response = await fetch(`${base}?${new URLSearchParams(params)}`, { redirect: 'error', signal: AbortSignal.timeout(5000) })
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_USIG_BYTES) {
    await response.body?.cancel()
    return null
  }
  const reader = response.body.getReader()
  const bytes = new Uint8Array(MAX_USIG_BYTES)
  let length = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      if (length + value.length > MAX_USIG_BYTES) return null
      bytes.set(value, length)
      length += value.length
    }
  } finally { await reader.cancel().catch(() => {}) }
  return JSON.parse(new TextDecoder().decode(bytes.subarray(0, length)))
}

/** USIG can suggest fuzzy matches. Confirm the exact CABA street and height before reading their barrio. */
export function lookupUsig(address: string, key: string) {
  const height = Number(key.split(' ').at(-1))
  return Effect.tryPromise(async () => {
    const candidates = Schema.decodeUnknownResult(usigAddresses)(await readUsig('https://servicios.usig.buenosaires.gob.ar/normalizar', { direccion: address }))
    if (candidates._tag !== 'Success') return null
    const matches = candidates.success.direccionesNormalizadas.filter(item => item.cod_partido === 'caba' && item.altura === height &&
      addressKey(`${item.nombre_calle.replace(/^([^,]+), ([^,]+?)( AV\.)?$/, '$2 $1$3')} ${height}`) === key)
    if (new Set(matches.map(item => item.cod_calle)).size > 1) return 'ambiguous' as const
    if (!matches.length) return null
    const area = Schema.decodeUnknownResult(usigArea)(await readUsig('https://ws.usig.buenosaires.gob.ar/datos_utiles',
      { calle: matches[0].nombre_calle, altura: String(height) }))
    return area._tag === 'Success' ? barrio(area.success.barrio) : null
  }).pipe(Effect.catch(() => Effect.succeed(null)))
}
