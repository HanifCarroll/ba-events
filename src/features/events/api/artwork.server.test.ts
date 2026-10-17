import { describe, expect, it, vi } from 'vitest'
import { serveArtwork, type ArtworkImages } from './artwork.server.ts'
import { artworkVersion } from '../lib/artwork-delivery.ts'

const id = 'e739fcbc-a83e-4a2e-b47d-0fd6e55b93e4'
const original = 'https://images.venti.live/user-images/test.jpg'
function setup(imageUrl = original) {
  const request = new Request(`https://baeventos.com/api/event-artwork/${id}/320.webp?v=${artworkVersion(imageUrl)}`)
  const lookup = vi.fn(async () => ({ image_url: imageUrl }))
  const fetchImage = vi.fn(async () => new Response('jpeg', { headers: { 'Content-Type': 'image/jpeg' } }))
  const transform = vi.fn()
  const output = vi.fn(async () => ({ response: ({ headers }: { headers: HeadersInit }) => new Response('webp', { headers }) }))
  transform.mockReturnValue({ output })
  const images = { info: vi.fn(async () => ({ width: 2600, height: 1000 })), input: vi.fn(() => ({ transform })) } as unknown as ArtworkImages
  return { request, id, variant: '320.webp', images, lookup, fetchImage, transform, output }
}

describe('catalog artwork delivery', () => {
  it.each([
    ['passline', 'https://imagenes.passline.com/eventos/test.jpg'],
    ['venti', original],
    ['meetup', 'https://secure.meetupstatic.com/photos/event/1/test.jpeg'],
    ['eventbrite', 'https://img.evbuc.com/https%3A%2F%2Fcdn.evbuc.com%2Fimages%2F123?w=512&s=signed'],
    ['luma', 'https://images.lumacdn.com/uploads/test.png'],
  ])('transforms %s media through the same bounded path', async (_source, url) => {
    const options = setup(url)
    const response = await serveArtwork(options)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/webp')
    expect(response.headers.get('X-Artwork-Width')).toBe('320')
    expect(response.headers.get('X-Artwork-Height')).toBe('123')
    expect(options.transform).toHaveBeenCalledWith({ width: 320, fit: 'scale-down' })
    expect(options.fetchImage).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: 'manual', headers: { Accept: 'image/*' } }))
  })

  it('serves a cached variant without a database read or transformation', async () => {
    const options = setup()
    const cache = { match: vi.fn(async () => new Response('cached')), put: vi.fn() }
    expect((await serveArtwork({ ...options, cache })).headers.get('X-Artwork-Cache')).toBe('HIT')
    expect(options.lookup).not.toHaveBeenCalled()
    expect(options.fetchImage).not.toHaveBeenCalled()
  })

  it('stores a transformed response and preserves the original aspect ratio', async () => {
    const options = setup()
    const cache = { match: vi.fn(async () => undefined), put: vi.fn(async () => {}) }
    const response = await serveArtwork({ ...options, cache })
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=86400')
    expect(cache.put).toHaveBeenCalledOnce()
    expect(options.output).toHaveBeenCalledWith({ format: 'image/webp', quality: 75, anim: false })
  })

  it.each(['9999.webp', '../320.webp', '320.avif'])('rejects unbounded variant %s before a read', async (variant) => {
    const options = setup()
    expect((await serveArtwork({ ...options, variant })).status).toBe(400)
    expect(options.lookup).not.toHaveBeenCalled()
  })

  it('rejects upstream URL parameters and non-catalog identifiers', async () => {
    const options = setup()
    const request = new Request(options.request.url + '&url=https://127.0.0.1/private')
    expect((await serveArtwork({ ...options, request })).status).toBe(400)
    expect((await serveArtwork({ ...options, id: 'not-an-event' })).status).toBe(400)
    expect(options.fetchImage).not.toHaveBeenCalled()
  })

  it('never fetches disallowed catalog origins', async () => {
    const options = setup('https://127.0.0.1/image.jpg')
    expect((await serveArtwork(options)).status).toBe(404)
    expect(options.fetchImage).not.toHaveBeenCalled()
  })

  it('rejects obsolete versions without multiplying transformation variants', async () => {
    const options = setup()
    const request = new Request(options.request.url.replace(/v=.*/, 'v=old'))
    expect((await serveArtwork({ ...options, request })).status).toBe(404)
    expect(options.fetchImage).not.toHaveBeenCalled()
  })

  it('does not follow redirects or cache the original-image fallback', async () => {
    const options = setup()
    const fetchImage = vi.fn(async () => new Response(null, { status: 302, headers: { Location: 'http://localhost/private' } }))
    const cache = { match: vi.fn(async () => undefined), put: vi.fn(async () => {}) }
    const response = await serveArtwork({ ...options, fetchImage, cache })
    expect(response.status).toBe(307)
    expect(response.headers.get('Location')).toBe(original)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(cache.put).not.toHaveBeenCalled()
    expect(fetchImage).toHaveBeenCalledOnce()
  })

  it('falls back safely on quota exhaustion', async () => {
    const options = setup()
    vi.mocked(options.images.info).mockRejectedValueOnce(new Error('9422 free quota exceeded'))
    expect((await serveArtwork(options)).headers.get('Location')).toBe(original)
  })

  it('limits bytes, media type and decoded pixel count before transformation', async () => {
    for (const headers of [
      { 'Content-Type': 'image/jpeg', 'Content-Length': '10485761' },
      { 'Content-Type': 'text/html' },
    ] as Record<string, string>[]) {
      const options = setup()
      const fetchImage = vi.fn(async () => new Response('invalid', { headers }))
      expect((await serveArtwork({ ...options, fetchImage })).status).toBe(307)
      expect(options.images.input).not.toHaveBeenCalled()
    }
    const options = setup()
    vi.mocked(options.images.info).mockResolvedValueOnce({ format: 'image/jpeg', fileSize: 10, width: 10000, height: 10000 })
    expect((await serveArtwork(options)).status).toBe(307)
    expect(options.images.input).not.toHaveBeenCalled()
  })
})
