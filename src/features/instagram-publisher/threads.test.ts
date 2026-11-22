import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { addDays, baInstant, priceLabel } from './format.ts'
import { readConfig } from './runtime.ts'
import type { PostEvent } from './select.ts'
import { threadsApi } from './threads-api.ts'
import { threadsPreview, threadsText } from './threads-copy.ts'
import { loadThreadsToken, readThreadsToken } from './threads-token.ts'

const dirs: string[] = []
const temporaryFile = (name: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'threads-test-'))
  dirs.push(dir)
  return join(dir, name)
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const pick = { id: 'sample', date: '2026-11-20', startsAt: '2026-11-20T22:30:00.000Z', title: 'Cine del barrio', time: '19:30 a 21:30',
  description: null, venue: 'La Linterna', barrio: 'Boedo', price: null, handle: null, via: false } satisfies PostEvent

describe('Threads text fitting', () => {
  it('uses the saved price labels, removes emoji and hashtag sigils, and gives only the start time', () => {
    const prices = [priceLabel({ isFree: true, price: 0, payWhatYouWant: false }), priceLabel({ isFree: false, price: 12000, payWhatYouWant: false }),
      priceLabel({ isFree: false, price: null, payWhatYouWant: true }), priceLabel({ isFree: false, price: null, payWhatYouWant: false })]
    const events = prices.map(price => ({ ...pick, title: 'Cine 🎞️ del #barrio', price }))
    const text = threadsText('hoy', events)
    expect(text).toBe(`Hoy en Buenos Aires, 4 planes de cultura independiente:\n\n19:30 · Cine del barrio · La Linterna, Boedo · Gratis\n19:30 · Cine del barrio · La Linterna, Boedo · $12.000\n19:30 · Cine del barrio · La Linterna, Boedo · A la gorra\n19:30 · Cine del barrio · La Linterna, Boedo\n\nToda la agenda de hoy: baeventos.com`)
    expect(threadsText('gratis', events)).not.toContain(' · Gratis')
  })

  it('counts Unicode code points, not UTF-16 units, including the entire footer', () => {
    const sample = { ...pick, title: 'Cine 𠮷' }
    const short = threadsText('hoy', [sample, sample])!
    const atLimit = threadsText('hoy', [{ ...sample, title: sample.title + '𠮷'.repeat(500 - [...short].length) }, sample])!
    expect([...atLimit]).toHaveLength(500)
    expect(atLimit.length).toBeGreaterThan(500)
    expect(atLimit).not.toContain('…')
    expect(atLimit.endsWith('Toda la agenda de hoy: baeventos.com')).toBe(true)
  })

  it('trims six weekend picks to four without losing a day or reordering the post', () => {
    const picks = Array.from({ length: 6 }, (_, i) => {
      const date = addDays(pick.date, Math.floor(i / 2))
      return { ...pick, date, startsAt: baInstant(date, 19 + i % 2).toISOString(),
        title: `Muestra ${i + 1}: Una noche de teatro, música y lecturas` }
    })
    const text = threadsText('finde', picks)!
    expect(text).toContain('4 planes')
    expect([...text].length).toBeLessThanOrEqual(500)
    expect(text.match(/^(Vie|Sáb|Dom) \d\d:\d\d · Muestra \d/gm)).toEqual([
      'Vie 19:00 · Muestra 1', 'Vie 20:00 · Muestra 2', 'Sáb 19:00 · Muestra 3', 'Dom 19:00 · Muestra 5',
    ])
  })

  it('removes a matching dash suffix and title-cases an all-caps venue in Threads only', () => {
    const venue = 'CAFE ROCK LA VE'
    const events = [
      { ...pick, venue, title: 'Bufosa - Cafe Rock la VE' },
      { ...pick, venue, title: 'Lecturas – Café Rock La V.E.' },
      { ...pick, venue, title: 'Cine – Sala distinta' },
    ]
    const text = threadsText('hoy', events)
    expect(text).toContain('Bufosa · Cafe Rock la Ve, Boedo')
    expect(text).toContain('Lecturas · Cafe Rock la Ve, Boedo')
    expect(text).toContain('Cine – Sala distinta · Cafe Rock la Ve, Boedo')
    expect(events[0]).toMatchObject({ venue, title: 'Bufosa - Cafe Rock la VE' })
  })

  it('quotes styling delimiters and escapes Slack control characters without changing the public text', () => {
    const text = 'Cine *en* _el_ ~patio~ `de noche` & <cine>'
    const preview = threadsPreview(text, baInstant('2026-11-20', 12))
    expect(preview).toContain('>>> ```\nCine *en* _el_ ~patio~ `de noche` &amp; &lt;cine&gt;\n```')
  })

  it('refuses to cut venue or barrio names if even the minimum list cannot fit', () => {
    const hugeVenue = { ...pick, venue: 'Centro Cultural del Sur '.repeat(20) }
    expect(threadsText('hoy', [hugeVenue, hugeVenue])).toBeNull()
  })
})

describe('Threads config and token', () => {
  const old = { access_token: 'old-synthetic', account: 'baeventos.app', app_id: 'app-1', obtained: '2026-11-01T12:00:00.000Z' }
  const fileWithToken = () => {
    const file = temporaryFile('threads-token.json')
    writeFileSync(file, JSON.stringify(old), { mode: 0o600 })
    return file
  }

  it('defaults to disabled with all the auto flags off', () => {
    const file = temporaryFile('config.json')
    expect(readConfig(file).threads).toEqual({ enabled: false, auto: { hoy: false, finde: false, gratis: false } })
    writeFileSync(file, JSON.stringify({ threads: { enabled: true, auto: { gratis: true, finde: 'true', reel: true } } }))
    expect(readConfig(file).threads).toEqual({ enabled: true, auto: { hoy: false, finde: false, gratis: true } })
  })

  it('refreshes an old token and writes it back atomically with mode 600', async () => {
    const file = fileWithToken()
    const before = statSync(file)
    const now = new Date('2026-11-09T12:00:00.000Z')
    const refresh = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ access_token: 'new-synthetic', expires_in: 5184000 }))
    expect(await loadThreadsToken(now, refresh, file)).toEqual({ accessToken: 'new-synthetic', warning: null })
    const url = new URL(String(refresh.mock.calls[0]![0]))
    expect(url.origin + url.pathname).toBe('https://graph.threads.net/refresh_access_token')
    expect(Object.fromEntries(url.searchParams)).toEqual({ grant_type: 'th_refresh_token', access_token: old.access_token })
    expect(readThreadsToken(file)).toEqual({ ...old, access_token: 'new-synthetic', obtained: now.toISOString() })
    const after = statSync(file)
    expect(after.ino).not.toBe(before.ino)
    expect(after.mode & 0o777).toBe(0o600)
  })

  it('does not refresh a fresh token or reveal an error that echoes a token, and warns at ten days', async () => {
    const file = fileWithToken()
    const refresh = vi.fn<typeof fetch>().mockRejectedValue(new Error(`request leaked ${old.access_token}`))
    expect(await loadThreadsToken(new Date('2026-11-08T12:00:00.000Z'), refresh, file)).toEqual({ accessToken: old.access_token, warning: null })
    expect(refresh).not.toHaveBeenCalled()
    const result = await loadThreadsToken(new Date('2026-12-21T12:00:00.000Z'), refresh, file)
    expect(result.warning).toContain('Could not refresh')
    expect(result.warning).toContain('10 days left')
    expect(result.warning).not.toContain(old.access_token)
    expect(readFileSync(file, 'utf8')).toBe(JSON.stringify(old))
    expect((await loadThreadsToken(new Date('2026-12-31T12:00:00.000Z'), refresh, file)).accessToken).toBeNull()
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})

describe('Threads Graph requests', () => {
  it('refuses a wrong account before posting', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: '42', username: 'other.account' }))
    await expect(threadsApi('synthetic', fetcher)).rejects.toThrow('la cuenta no es @baeventos.app')
    expect(fetcher).toHaveBeenCalledTimes(1)
    const url = new URL(String(fetcher.mock.calls[0]![0]))
    expect(url.href).toBe('https://graph.threads.net/v1.0/me?fields=id%2Cusername')
  })

  it.each([
    [{ code: 100 }, true], [{ code: 190, error_subcode: 463 }, true],
    [{ code: 1 }, false], [{ code: 100, error_subcode: 9_999 }, false], [{ code: 190, is_transient: true }, false],
  ] as const)('classifies only specific pre-dispatch Graph rejections (%j)', async (error, definitive) => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id: '42', username: 'baeventos.app' }))
      .mockResolvedValueOnce(Response.json({ error }, { status: 400 }))
    const client = await threadsApi('synthetic', fetcher)
    await expect(client.publish('123')).rejects.toMatchObject({ definitive })
  })

  it('uses the required text, topic, attachment, quota, publish, and insights endpoints', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ id: '42', username: 'baeventos.app' }))
      .mockResolvedValueOnce(Response.json({ id: '123' }))
      .mockResolvedValueOnce(Response.json({ status: 'FINISHED' }))
      .mockResolvedValueOnce(Response.json({ data: [{ quota_usage: 1, config: { quota_total: 250 } }] }))
      .mockResolvedValueOnce(Response.json({ id: '456' }))
      .mockResolvedValueOnce(Response.json({ data: [] }))
      .mockResolvedValueOnce(Response.json({ data: [] }))
      .mockResolvedValueOnce(Response.json({ data: [] }))
    const api = await threadsApi('synthetic', fetcher)
    expect(await api.create('Cine en Boedo')).toBe('123')
    expect(await api.status('123')).toBe('FINISHED')
    await api.checkLimit()
    expect(await api.publish('123')).toBe('456')
    await api.recent()
    await api.mediaInsights('456')
    await api.accountInsights()
    const calls = fetcher.mock.calls.map(([url, init]) => [new URL(String(url)), init] as const)
    expect(calls.map(([url, init]) => `${init?.method} ${url.pathname}`)).toEqual(['GET /v1.0/me', 'POST /v1.0/42/threads', 'GET /v1.0/123',
      'GET /v1.0/me/threads_publishing_limit', 'POST /v1.0/42/threads_publish', 'GET /v1.0/me/threads', 'GET /v1.0/456/insights', 'GET /v1.0/42/threads_insights'])
    expect(calls[1]![1]?.body?.toString()).toBe('media_type=TEXT&text=Cine+en+Boedo&topic_tag=Buenos+Aires&link_attachment=https%3A%2F%2Fbaeventos.com')
    expect(calls[4]![1]?.body?.toString()).toBe('creation_id=123')
    expect(calls[1]![1]?.headers).toEqual({ Authorization: 'Bearer synthetic' })
    expect(calls[2]![0].searchParams.get('fields')).toBe('status,error_message')
    expect(calls[5]![0].searchParams.get('fields')).toBe('id,text,permalink,timestamp')
    expect(calls[6]![0].searchParams.get('metric')).toBe('views,likes,replies,reposts,quotes')
    expect(calls[7]![0].searchParams.get('metric')).toBe('views,followers_count')
  })
})
