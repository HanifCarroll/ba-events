/** Flyer downloads on synthetic images: every failure leaves the event without artwork and never throws. */
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { fetchArtwork } from './artwork.ts'

const image = (width: number, height: number, format: 'jpeg' | 'png' | 'webp' = 'jpeg') =>
  sharp({ create: { width, height, channels: 3, background: '#ff1fa0' } })[format]().toBuffer()
const event = (id: string, imageUrl: string | null) => ({ id, title: `Evento ${id}`, imageUrl })
const ok = (bytes: Buffer, init?: ResponseInit) => new Response(new Uint8Array(bytes), init)
const dir = () => join(mkdtempSync(join(tmpdir(), 'ig-art-')), 'art')

describe('fetching artwork', () => {
  it('prepares each flyer at no more than 1280 px, with a small dark backdrop, whatever its format', async () => {
    const bodies: Record<string, Buffer> = {
      'https://img.example/a.jpg': await image(3000, 3750),
      'https://img.example/b.png': await image(600, 600, 'png'),
      'https://img.example/c.webp': await image(900, 1600, 'webp'),
    }
    const logs: string[] = []
    const out = dir()
    const art = await fetchArtwork(Object.keys(bodies).map((url, i) => event(`e${i}`, url)), out, m => logs.push(m), (async (url: string) => ok(bodies[url]!)) as unknown as typeof fetch)
    expect(logs).toEqual([])
    expect(art.e0).toMatchObject({ width: 1024, height: 1280 })
    expect(art.e1).toMatchObject({ width: 600, height: 600 })
    expect(art.e2).toMatchObject({ width: 720, height: 1280 })
    for (const { file, backdrop } of Object.values(art)) {
      expect((await sharp(file).metadata()).format).toBe('jpeg')
      const bg = await sharp(backdrop).stats()
      expect(Math.max(...bg.channels.map(channel => channel.mean))).toBeLessThan(120)
    }
    expect(readdirSync(out)).toHaveLength(6)
  })

  it('leaves an event without artwork, and says why, on any failure', async () => {
    const good = await image(800, 1000)
    const responses: Record<string, () => Response | Promise<Response>> = {
      'https://img.example/missing.jpg': () => new Response('no', { status: 404 }),
      'https://img.example/page.jpg': () => new Response('<html>not an image</html>'),
      'https://img.example/huge.jpg': () => ok(good, { headers: { 'content-length': String(16 * 1024 * 1024) } }),
      'https://img.example/stream.jpg': () => new Response(new Uint8Array(16 * 1024 * 1024)),
      'https://img.example/slow.jpg': () => { throw new DOMException('The operation timed out.', 'TimeoutError') },
      'https://img.example/vector.jpg': () => new Response('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000"/></svg>'),
      'https://img.example/good.jpg': () => ok(good),
    }
    const icon = await image(64, 64)
    responses['https://img.example/icon.jpg'] = () => ok(icon)
    const asked: string[] = []
    const fake = (async (url: string) => { asked.push(url); return responses[url]!() }) as unknown as typeof fetch
    const events = [event('none', null), event('http', 'http://img.example/good.jpg'), event('junk', 'not a url'),
      ...Object.keys(responses).map(url => event(url.split('/').pop()!.replace('.jpg', ''), url))]
    const logs: string[] = []
    const art = await fetchArtwork(events, dir(), m => logs.push(m), fake)
    expect(Object.keys(art)).toEqual(['good'])
    expect(asked).not.toContain('http://img.example/good.jpg')
    expect(logs).toHaveLength(events.length - 1)
    for (const [id, why] of [['none', 'has no image'], ['http', 'not an https URL'], ['junk', 'not an https URL'], ['missing', 'HTTP 404'], ['huge', 'larger than 15 MB'],
      ['stream', 'larger than 15 MB'], ['vector', 'not a JPEG, PNG, WebP, GIF, or AVIF image (svg)'], ['slow', 'timed out'], ['icon', 'only 64 × 64 px']] as const) {
      expect(logs.find(line => line.includes(`artwork: ${id} `)), id).toContain(why)
    }
    expect(logs.find(line => line.includes('artwork: page '))).toContain('using the no-flyer card')
  })

  it('empties its directory first, so an earlier render\'s flyers never leak into this one', async () => {
    const out = dir()
    const good = await image(800, 1000)
    const serve = (async () => ok(good)) as unknown as typeof fetch
    await fetchArtwork([event('a', 'https://img.example/a.jpg'), event('b', 'https://img.example/b.jpg')], out, () => {}, serve)
    await fetchArtwork([event('a', 'https://img.example/a.jpg')], out, () => {}, serve)
    expect(readdirSync(out).sort()).toEqual(['art-1-bg.jpg', 'art-1.jpg'])
    expect(existsSync(out)).toBe(true)
  })
})
