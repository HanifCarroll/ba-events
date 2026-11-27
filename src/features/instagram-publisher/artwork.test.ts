/** Flyer downloads on synthetic images: every failure leaves the event without artwork and never throws. */
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { decodeArtworkRef } from '#shared/lib/artwork-ref.ts'
import { downloadCatalogArtwork, fetchArtwork, loadSharp } from './artwork.ts'

const image = (width: number, height: number, format: 'jpeg' | 'png' | 'webp' = 'jpeg') =>
  sharp({ create: { width, height, channels: 3, background: '#ff1fa0' } })[format]().toBuffer()
const event = (id: string, value: string | null) => ({ id, title: `Evento ${id}`, artworkRef: decodeArtworkRef(value, id) })
const ok = (bytes: Buffer, init?: ResponseInit) => new Response(new Uint8Array(bytes), init)
const dir = () => join(mkdtempSync(join(tmpdir(), 'ig-art-')), 'art')

describe('fetching artwork', () => {
  it('prepares each flyer at no more than 1280 px, with a small dark backdrop, whatever its format', async () => {
    const bodies: Record<string, Buffer> = {
      'https://imagenes.passline.com/eventos/a.jpg': await image(3000, 3750),
      'https://imagenes.passline.com/eventos/b.png': await image(600, 600, 'png'),
      'https://imagenes.passline.com/eventos/c.webp': await image(900, 1600, 'webp'),
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
      'https://imagenes.passline.com/eventos/missing.jpg': () => new Response('no', { status: 404 }),
      'https://imagenes.passline.com/eventos/page.jpg': () => new Response('<html>not an image</html>'),
      'https://imagenes.passline.com/eventos/huge.jpg': () => ok(good, { headers: { 'content-length': String(16 * 1024 * 1024) } }),
      'https://imagenes.passline.com/eventos/stream.jpg': () => new Response(new Uint8Array(16 * 1024 * 1024)),
      'https://imagenes.passline.com/eventos/slow.jpg': () => { throw new DOMException('The operation timed out.', 'TimeoutError') },
      'https://imagenes.passline.com/eventos/vector.jpg': () => new Response('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000"/></svg>'),
      'https://imagenes.passline.com/eventos/good.jpg': () => ok(good),
    }
    const icon = await image(64, 64)
    responses['https://imagenes.passline.com/eventos/icon.jpg'] = () => ok(icon)
    const asked: string[] = []
    const fake = (async (url: string) => { asked.push(url); return responses[url]!() }) as unknown as typeof fetch
    const events = [event('none', null), event('http', 'http://imagenes.passline.com/eventos/good.jpg'), event('junk', 'not a url'),
      ...Object.keys(responses).map(url => event(url.split('/').pop()!.replace('.jpg', ''), url))]
    const logs: string[] = []
    const art = await fetchArtwork(events, dir(), m => logs.push(m), fake)
    expect(Object.keys(art)).toEqual(['good'])
    expect(asked).not.toContain('http://imagenes.passline.com/eventos/good.jpg')
    expect(logs).toHaveLength(events.length - 1)
    for (const [id, why] of [['none', 'has no image'], ['http', 'not an https URL'], ['junk', 'not an https URL'], ['missing', 'HTTP 404'], ['huge', 'larger than 15 MB'],
      ['stream', 'larger than 15 MB'], ['vector', 'not a JPEG, PNG, WebP, GIF, or AVIF image (svg)'], ['slow', 'timed out'], ['icon', 'only 64 × 64 px']] as const) {
      expect(logs.find(line => line.includes(`artwork: ${id} `)), id).toContain(why)
    }
    expect(logs.find(line => line.includes('artwork: page '))).toContain('using the no-flyer card')
  })

  it('never requests an address outside the catalog\'s known image origins', async () => {
    const asked: string[] = []
    const fake = (async (url: string) => { asked.push(url); return ok(await image(800, 1000)) }) as unknown as typeof fetch
    const urls = [
      'https://internal.example/flyer.jpg', 'https://127.0.0.1/eventos/a.jpg', 'https://169.254.169.254/latest/meta-data', 'https://localhost:8443/a.jpg',
      'https://baeventos.com/api/admin', 'https://imagenes.passline.com/other/a.jpg', 'https://imagenes.passline.com.evil.example/eventos/a.jpg', 'https://user@imagenes.passline.com/eventos/a.jpg',
    ]
    const logs: string[] = []
    const art = await fetchArtwork([...urls.map((url, i) => event(`bad${i}`, url)), event('good', 'https://imagenes.passline.com/eventos/a.jpg')],
      dir(), m => logs.push(m), fake)
    expect(Object.keys(art)).toEqual(['good'])
    expect(asked).toEqual(['https://imagenes.passline.com/eventos/a.jpg'])
    expect(logs).toHaveLength(urls.length)
    for (const line of logs) expect(line).toContain('failed (not an allowed artwork origin); using the no-flyer card')
  })

  it('reads the same public original by key from a stored or legacy catalog value', async () => {
    const id = 'fcd772a2-9b05-4e1a-b6bc-e5503726a597'
    const key = `${'ab'.repeat(32)}.jpg`
    const publicUrl = `https://baeventos.com/api/event-artwork/${id}/${key}`
    const good = await image(800, 1000)
    let requests = 0
    const fake: typeof fetch = async (url, init) => {
      requests++
      expect(url).toBe(publicUrl)
      expect(init).toMatchObject({ redirect: 'manual', signal: expect.any(AbortSignal) })
      return ok(good)
    }
    for (const value of [`r2:image/jpeg:${key}`, publicUrl]) {
      const ref = event(id, value).artworkRef!
      expect(await downloadCatalogArtwork(id, ref, fake)).toEqual(good)
      await expect(downloadCatalogArtwork(id, ref, async () => new Response(null, {
        status: 302, headers: { Location: 'https://imagenes.passline.com/eventos/other.jpg' },
      }))).rejects.toThrow('HTTP 302')
    }
    await expect(downloadCatalogArtwork('..', { kind: 'stored', key, contentType: 'image/jpeg' }, fake)).rejects.toThrow('Invalid stored artwork reference')
    expect(requests).toBe(2)
  })

  describe('redirects', () => {
    const hop = (location: string | null, cancelled?: string[], name = '') => new Response(
      new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(8)) }, cancel() { cancelled?.push(name) } }),
      { status: 302, headers: location ? { location } : {} })
    const run = async (routes: Record<string, () => Response>) => {
      const asked: Array<{ url: string; redirect?: string; signal?: AbortSignal | null }> = []
      const logs: string[] = []
      const fake = (async (url: string, init?: RequestInit) => { asked.push({ url, redirect: init?.redirect, signal: init?.signal }); return routes[url]!() }) as unknown as typeof fetch
      const art = await fetchArtwork([event('a', 'https://imagenes.passline.com/eventos/start.jpg')], dir(), m => logs.push(m), fake)
      return { art, asked, logs }
    }

    it('follows up to three https hops by hand, under one timeout, cancelling each redirect body', async () => {
      const good = await image(800, 1000)
      const cancelled: string[] = []
      const { art, asked, logs } = await run({
        'https://imagenes.passline.com/eventos/start.jpg': () => hop('two.jpg', cancelled, 'one'),
        'https://imagenes.passline.com/eventos/two.jpg': () => hop('https://images.venti.live/user-images/three.jpg', cancelled, 'two'),
        'https://images.venti.live/user-images/three.jpg': () => hop('https://images.venti.live/user-images/final.jpg', cancelled, 'three'),
        'https://images.venti.live/user-images/final.jpg': () => ok(good),
      })
      expect(logs).toEqual([])
      expect(art.a).toMatchObject({ width: 800, height: 1000 })
      expect(asked.map(request => request.url)).toEqual(['https://imagenes.passline.com/eventos/start.jpg', 'https://imagenes.passline.com/eventos/two.jpg', 'https://images.venti.live/user-images/three.jpg', 'https://images.venti.live/user-images/final.jpg'])
      expect(asked.every(request => request.redirect === 'manual')).toBe(true)
      expect(new Set(asked.map(request => request.signal)).size).toBe(1)
      expect(asked[0]!.signal).toBeInstanceOf(AbortSignal)
      expect(cancelled).toEqual(['one', 'two', 'three'])
    })

    it('never requests a hop that leaves https, and cancels the response that pointed there', async () => {
      const cancelled: string[] = []
      const { art, asked, logs } = await run({ 'https://imagenes.passline.com/eventos/start.jpg': () => hop('http://imagenes.passline.com/eventos/plain.jpg', cancelled, 'one') })
      expect(art).toEqual({})
      expect(asked).toHaveLength(1)
      expect(logs[0]).toContain('redirected off https')
      expect(cancelled).toEqual(['one'])
    })

    it('never follows a redirect from an allowed origin to one that isn\'t, and cancels its body', async () => {
      for (const target of ['https://internal.example/flyer.jpg', 'https://10.0.0.5/eventos/a.jpg', 'https://baeventos.com/api/admin', 'https://imagenes.passline.com/other/a.jpg']) {
        const cancelled: string[] = []
        const { art, asked, logs } = await run({ 'https://imagenes.passline.com/eventos/start.jpg': () => hop(target, cancelled, 'one') })
        expect(art, target).toEqual({})
        expect(asked.map(request => request.url), target).toEqual(['https://imagenes.passline.com/eventos/start.jpg'])
        expect(logs[0], target).toContain(`failed (redirected to an origin that isn't allowed (${new URL(target).hostname})); using the no-flyer card`)
        expect(cancelled, target).toEqual(['one'])
      }
    })

    it('stops at a fourth redirect, a redirect without a Location, and an error status', async () => {
      const cancelled: string[] = []
      const loop = await run({ 'https://imagenes.passline.com/eventos/start.jpg': () => hop('https://imagenes.passline.com/eventos/start.jpg', cancelled, 'loop') })
      expect(loop.asked).toHaveLength(4)
      expect(loop.logs[0]).toContain('more than 3 redirects')
      expect(cancelled).toHaveLength(4)
      expect((await run({ 'https://imagenes.passline.com/eventos/start.jpg': () => hop(null) })).logs[0]).toContain('HTTP 302 without a Location')
      const gone: string[] = []
      const missing = await run({ 'https://imagenes.passline.com/eventos/start.jpg': () => new Response(new ReadableStream({ cancel() { gone.push('body') } }), { status: 404 }) })
      expect(missing.logs[0]).toContain('HTTP 404')
      expect(gone).toEqual(['body'])
    })
  })

  it('fails with a message naming `bun install` when sharp is missing', async () => {
    await expect(loadSharp(async () => { throw new Error("Cannot find package 'sharp'") })).rejects.toThrow(/sharp did not load \(Cannot find package 'sharp'\)\. Run `bun install`/)
    expect(typeof (await loadSharp())).toBe('function')
  })

  it('empties its directory first, so an earlier render\'s flyers never leak into this one', async () => {
    const out = dir()
    const good = await image(800, 1000)
    const serve = (async () => ok(good)) as unknown as typeof fetch
    await fetchArtwork([event('a', 'https://imagenes.passline.com/eventos/a.jpg'), event('b', 'https://imagenes.passline.com/eventos/b.jpg')], out, () => {}, serve)
    await fetchArtwork([event('a', 'https://imagenes.passline.com/eventos/a.jpg')], out, () => {}, serve)
    expect(readdirSync(out).sort()).toEqual(['art-1-bg.jpg', 'art-1.jpg'])
    expect(existsSync(out)).toBe(true)
  })
})
