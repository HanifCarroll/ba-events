import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractEventbriteDetailImage, fetchEventbriteDetail, readImageDimensions } from './detail.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Eventbrite detail image extraction', () => {
  it('prefers the Event JSON-LD image and preserves dimensions', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Event',
      image: { url: 'https://img.evbuc.com/detail.jpg?w=940&h=1174', width: 940, height: 1174 },
    })}</script>`
    expect(extractEventbriteDetailImage(html)).toEqual({
      url: 'https://img.evbuc.com/detail.jpg?w=940&h=1174',
      width: 940,
      height: 1174,
    })
  })

  it('fails safely when JSON-LD has no usable image', () => {
    expect(extractEventbriteDetailImage('<script type="application/ld+json">bad</script>')).toEqual({
      url: null,
      width: null,
      height: null,
    })
  })

  it('reads dimensions from image bytes when Eventbrite omits one', async () => {
    const imageUrl = 'https://img.evbuc.com/detail.png?w=940'
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Event',
      image: { url: imageUrl, width: 940 },
    })}</script>`
    const png = new Uint8Array(24)
    png.set([0x89, 0x50, 0x4e, 0x47], 0)
    new DataView(png.buffer).setUint32(16, 940)
    new DataView(png.buffer).setUint32(20, 1174)

    vi.stubGlobal(
      'fetch',
      vi.fn()
        .mockResolvedValueOnce(new Response(html))
        .mockResolvedValueOnce(new Response(png, { headers: { 'content-type': 'image/png' } })),
    )

    await expect(fetchEventbriteDetail('https://eventbrite.com/e/example')).resolves.toMatchObject({
      image_url: imageUrl,
      image_width: 940,
      image_height: 1174,
    })
  })
})

describe('image header dimensions', () => {
  it('reads a square GIF header', () => {
    const bytes = new Uint8Array([0x47, 0x49, 0x46, 0, 0, 0, 0xe8, 0x03, 0xe8, 0x03])
    expect(readImageDimensions(bytes)).toEqual({ width: 1000, height: 1000 })
  })

  it('reads a portrait WebP VP8X header', () => {
    const bytes = new Uint8Array(30)
    bytes.set([0x52, 0x49, 0x46, 0x46], 0)
    bytes.set([0x57, 0x45, 0x42, 0x50], 8)
    bytes.set([0x56, 0x50, 0x38, 0x58], 12)
    bytes.set([0xab, 0x03, 0x00], 24) // 939 + 1
    bytes.set([0x95, 0x04, 0x00], 27) // 1173 + 1
    expect(readImageDimensions(bytes)).toEqual({ width: 940, height: 1174 })
  })
})
