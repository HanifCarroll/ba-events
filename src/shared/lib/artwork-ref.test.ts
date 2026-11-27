import { describe, expect, it } from 'vitest'
import { decodeArtworkRef, encodeArtworkRef, type ArtworkRef } from './artwork-ref.ts'
import { catalogArtworkUrl } from './artwork-url.ts'

const id = 'e739fcbc-a83e-4a2e-b47d-0fd6e55b93e4'
const key = `${'a'.repeat(64)}.png`
const legacy = `https://baeventos.com/api/event-artwork/${id}/${key}`
const stored = `r2:image/png:${key}`

describe('catalog artwork references', () => {
  it('round-trips an external CDN URL without rewriting its encoding or query', () => {
    const url = 'https://img.evbuc.com/https%3A%2F%2Fcdn.evbuc.com%2Fimages%2F123?w=512&s=signed'
    const ref: ArtworkRef = { kind: 'external', url }
    expect(encodeArtworkRef(ref)).toBe(url)
    expect(decodeArtworkRef(url, id)).toEqual(ref)
    expect(catalogArtworkUrl(id, url)).toBe(url)
    expect(decodeArtworkRef(null, id)).toBeNull()
  })

  it('round-trips a stored original without a site origin, route, or event ID', () => {
    const ref: ArtworkRef = { kind: 'stored', key, contentType: 'image/png' }
    expect(encodeArtworkRef(ref)).toBe(stored)
    expect(decodeArtworkRef(stored, id)).toEqual(ref)
    expect(decodeArtworkRef(legacy, id)).toEqual(ref)
    expect(catalogArtworkUrl(id, stored)).toBe(legacy)
    expect(catalogArtworkUrl(id, legacy)).toBe(legacy)
  })

  it('does not grant stored-original access from a legacy URL for another event', () => {
    expect(decodeArtworkRef(legacy, 'f739fcbc-a83e-4a2e-b47d-0fd6e55b93e4')).toEqual({ kind: 'external', url: legacy })
  })

  it.each([`r2:image/jpeg:${key}`, `r2:image/png:../${key}`, `${stored}:extra`, `${stored}\n`])('rejects invalid stored encoding %s', (value) => {
    expect(decodeArtworkRef(value, id)).toBeNull()
    expect(catalogArtworkUrl(id, value)).toBeNull()
  })

  it('does not encode keys with a mismatched or unsupported content type', () => {
    expect(() => encodeArtworkRef({ kind: 'stored', key, contentType: 'image/jpeg' })).toThrow('Invalid stored artwork')
  })
})
