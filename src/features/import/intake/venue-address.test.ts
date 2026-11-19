import { afterEach, describe, expect, it, vi } from 'vitest'
import { Effect } from 'effect'
import { addressKey, lookupUsig } from './venue-address.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('lookupUsig', () => {
  // Cloudflare Workers reject `redirect: 'error'` before sending, which made every Worker lookup fail closed.
  it("asks for manual redirects, which the Workers runtime supports, and reads the barrio", async () => {
    const calls: RequestInit[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push(init)
      return String(url).includes('normalizar')
        ? Response.json({ direccionesNormalizadas: [{ cod_partido: 'caba', cod_calle: 20004, altura: 943,
          nombre_calle: 'SAENZ PEÑA, ROQUE, PRES. DIAGONAL NORTE AV.' }] })
        : Response.json({ barrio: 'San Nicolas' })
    }))
    const key = addressKey('Av. Roque Sáenz Peña 943')!
    expect(await Effect.runPromise(lookupUsig('Av. Roque Sáenz Peña 943, CABA', key, true))).toBe('San Nicolás')
    expect(calls.map(init => init.redirect)).toEqual(['manual', 'manual'])
  })

  it('treats a redirect as no confirmation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://example.com/' } })))
    const key = addressKey('Av. Roque Sáenz Peña 943')!
    expect(await Effect.runPromise(lookupUsig('Av. Roque Sáenz Peña 943, CABA', key, true))).toBeNull()
  })
})
