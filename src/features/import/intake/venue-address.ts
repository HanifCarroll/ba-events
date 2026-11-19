import { Effect, Schema } from 'effect'
import { NEIGHBORHOODS } from '#shared/lib/types.ts'
import { addressKey as catalogAddressKey } from '../core/venue-identity.ts'

export const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
// Exact barrio names only: the importers' partial matching would turn "Villa" into Villa Crespo.
export const barrio = (given: string) => NEIGHBORHOODS.find(item => fold(item) === fold(given.trim())) ?? null

/** Keep the catalog's loose formatting rules except where a CABA street's qualifier or alias matters. */
export function addressKey(address: string | null | undefined): string | null {
  if (!address) return null
  const suffix = /\s+av\.(?=\s+\d)/i
  const avenue = /^(?:\d+\s+)?(?:av(?:da)?\.|(?:av(?:da)?|avenida)\s)/i.test(address.trim()) || suffix.test(address)
  const key = catalogAddressKey(address.replace(suffix, ''))
  if (!key) return null
  if (avenue && /^(presidente )?sarmiento \d+$/.test(key)) return `avenida sarmiento ${key.split(' ').at(-1)}`
  if (avenue && /^(?:(?:presidente )?roque saenz pena|saenz pena roque pres diagonal norte) \d+$/.test(key)) {
    return `diagonal norte ${key.split(' ').at(-1)}`
  }
  return key
}

const usigAddresses = Schema.Struct({ direccionesNormalizadas: Schema.Array(Schema.Struct({
  cod_partido: Schema.String, nombre_calle: Schema.String, altura: Schema.NullOr(Schema.Number),
})) })
const usigArea = Schema.Struct({ barrio: Schema.String })

/** USIG can suggest fuzzy matches. Confirm the exact CABA street and height before reading their barrio. */
export function lookupUsig(address: string, key: string) {
  const height = Number(key.split(' ').at(-1))
  const read = async (base: string, params: Record<string, string>): Promise<unknown> => {
    const response = await fetch(`${base}?${new URLSearchParams(params)}`, { redirect: 'error', signal: AbortSignal.timeout(5000) })
    return response.ok ? response.json() : null
  }
  return Effect.tryPromise(async () => {
    const candidates = Schema.decodeUnknownResult(usigAddresses)(await read('https://servicios.usig.buenosaires.gob.ar/normalizar', { direccion: address }))
    if (candidates._tag !== 'Success') return null
    const exact = candidates.success.direccionesNormalizadas.find(item => item.cod_partido === 'caba' && item.altura === height &&
      addressKey(`${item.nombre_calle.replace(/^([^,]+), ([^,]+?)( AV\.)?$/, '$2 $1$3')} ${height}`) === key)
    if (!exact) return null
    const area = Schema.decodeUnknownResult(usigArea)(await read('https://ws.usig.buenosaires.gob.ar/datos_utiles',
      { calle: exact.nombre_calle, altura: String(height) }))
    return area._tag === 'Success' ? barrio(area.success.barrio) : null
  }).pipe(Effect.catch(() => Effect.succeed(null)))
}
