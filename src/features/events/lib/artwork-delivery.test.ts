import { describe, expect, it } from 'vitest'
import { artworkSrcset, artworkVersion, isArtworkOriginAllowed } from './artwork-delivery.ts'

const SOURCE_IMAGES = [
  ['passline', 'https://imagenes.passline.com/eventos/example-rec.jpg'],
  ['venti', 'https://images.venti.live/user-images/example-lg.jpg'],
  ['meetup', 'https://secure.meetupstatic.com/photos/event/1/highres_1.jpeg'],
  ['eventbrite', 'https://img.evbuc.com/https%3A%2F%2Fcdn.evbuc.com%2Fimages%2F123%2Foriginal?w=512&s=signed'],
  ['luma', 'https://images.lumacdn.com/uploads/example.png'],
]

describe('bounded artwork delivery', () => {
  it('allows only the configured project and retained public artwork paths', () => {
    const origin = 'https://synthetic.supabase.co'
    const path = `/storage/v1/object/public/event-artwork/${'a'.repeat(64)}.jpg`
    expect(isArtworkOriginAllowed(origin + path, origin)).toBe(true)
    expect(isArtworkOriginAllowed(origin + path)).toBe(false)
    expect(isArtworkOriginAllowed('https://other.supabase.co' + path, origin)).toBe(false)
    expect(isArtworkOriginAllowed(origin + path + '?redirect=1', origin)).toBe(false)
    expect(isArtworkOriginAllowed(origin + '/storage/v1/object/public/instagram-evidence/private.jpg', origin)).toBe(false)
  })
  it('caps candidate descriptors and removes duplicate no-upscale variants when source dimensions are known', () => {
    const sources = artworkSrcset('catalog-id', SOURCE_IMAGES[0][1], 400)
    expect(sources).toContain(' 320w')
    expect(sources).toContain(' 400w')
    expect(sources).not.toContain(' 640w')
    expect(sources).not.toContain('1280.webp')
  })
  it.each(SOURCE_IMAGES)('supports %s artwork without changing signed upstream URLs', (_source, url) => {
    expect(isArtworkOriginAllowed(url)).toBe(true)
    expect(artworkSrcset('catalog-id', url)).toContain(`/320.webp?v=${artworkVersion(url)} 320w`)
  })
  it.each([
    'http://imagenes.passline.com/eventos/a.jpg', 'https://imagenes.passline.com.attacker.test/eventos/a.jpg',
    'https://localhost/a.jpg', 'https://127.0.0.1/a.jpg', 'https://[::1]/a.jpg',
    'https://user:pass@imagenes.passline.com/eventos/a.jpg', 'https://imagenes.passline.com:444/eventos/a.jpg',
    'https://imagenes.passline.com/redirect?url=http://localhost',
    'https://img.evbuc.com/https%3A%2F%2Flocalhost%2Fprivate', 'data:image/png;base64,abc',
  ])('rejects non-media and private origins: %s', (url) => { expect(isArtworkOriginAllowed(url)).toBe(false) })
})
