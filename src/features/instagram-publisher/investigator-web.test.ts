import { EventEmitter } from 'node:events'
import type { RequestOptions } from 'node:https'
import { Readable } from 'node:stream'
import { beforeEach, expect, it, vi } from 'vitest'
import { researchSearch } from './investigator-web.ts'

const { httpsRequest, resolve4 } = vi.hoisted(() => ({
  httpsRequest: vi.fn<(url: URL, options: RequestOptions, receive: (response: Readable) => void) => EventEmitter>(),
  resolve4: vi.fn(async (_host: string) => ['1.1.1.1']),
}))
vi.mock('node:dns/promises', () => ({ Resolver: class { resolve4 = resolve4 } }))
vi.mock('node:https', () => ({
  request: httpsRequest,
  get: (url: URL, options: RequestOptions, receive: (response: Readable) => void) => httpsRequest(url, options, receive),
}))

const requests: { url: string; method: string; body?: string; address?: unknown }[] = []
const respond = (statusCode: number, html = '') => {
  httpsRequest.mockImplementationOnce((url, options, receive) => {
    const record: typeof requests[number] = { url: url.href, method: options.method ?? 'GET' }
    requests.push(record)
    options.lookup?.(url.hostname, { family: 4 }, (_error, address) => { record.address = address })
    const response = Object.assign(Readable.from([html]), { statusCode, headers: { 'content-type': 'text/html' } })
    queueMicrotask(() => receive(response))
    return Object.assign(new EventEmitter(), { end(body?: string) { record.body = body } })
  })
}

beforeEach(() => {
  requests.length = 0
  httpsRequest.mockReset()
  resolve4.mockClear()
})

it('posts the search form, then parses up to eight lite results when HTML search returns 202', async () => {
  const redirect = encodeURIComponent('https://venue.example/event?show=1')
  const links = Array.from({ length: 9 }, (_, i) => `<a class="result-link" href="https://events.example/${i}">Listing ${i}</a>`).join('')
  respond(202, '<title>Challenge</title>')
  respond(200, `<a href="https://other.example">Not a result</a>
    <a class="result-link" href="//duckduckgo.com/l/?uddg=${redirect}">Venue &amp; tickets</a>${links}`)
  expect(await researchSearch('teatro & música')).toEqual([
    { title: 'Venue & tickets', url: 'https://venue.example/event?show=1' },
    ...Array.from({ length: 7 }, (_, i) => ({ title: `Listing ${i}`, url: `https://events.example/${i}` })),
  ])
  expect(requests).toEqual([
    { url: 'https://html.duckduckgo.com/html/', method: 'POST', body: 'q=teatro+%26+m%C3%BAsica', address: '1.1.1.1' },
    { url: 'https://lite.duckduckgo.com/lite/?q=teatro+%26+m%C3%BAsica', method: 'GET', body: undefined, address: '1.1.1.1' },
  ])
  expect(httpsRequest.mock.calls[0]?.[1].headers).toMatchObject({ 'Content-Type': 'application/x-www-form-urlencoded' })
  expect(resolve4.mock.calls).toEqual([['html.duckduckgo.com'], ['lite.duckduckgo.com']])
})

it('returns HTML results without contacting lite when the POST succeeds', async () => {
  respond(200, '<a class="result__a" href="https://venue.example/">Venue</a>')
  expect(await researchSearch('theater')).toEqual([{ title: 'Venue', url: 'https://venue.example/' }])
  expect(httpsRequest).toHaveBeenCalledTimes(1)
})

it('tries lite when HTML search returns HTTP 200 without result links', async () => {
  respond(200, '<a href="https://other.example/">Not a result</a>')
  respond(200, '<a class="result-link" href="https://venue.example/">Venue</a>')
  expect(await researchSearch('theater')).toEqual([{ title: 'Venue', url: 'https://venue.example/' }])
  expect(requests.map(({ url, method }) => [url, method])).toEqual([
    ['https://html.duckduckgo.com/html/', 'POST'],
    ['https://lite.duckduckgo.com/lite/?q=theater', 'GET'],
  ])
})

it('returns an empty list if HTML search has no results and lite is unavailable', async () => {
  respond(200, '<p>No results</p>')
  respond(202)
  expect(await researchSearch('"theater"')).toEqual([])
  expect(httpsRequest).toHaveBeenCalledTimes(2)
})

it('suggests researching a known URL when both search endpoints fail', async () => {
  respond(202)
  respond(503)
  await expect(researchSearch('theater')).rejects.toThrow('Web search is unavailable right now; use research on a known URL instead.')
  expect(httpsRequest).toHaveBeenCalledTimes(2)
})

it.each([200, 202])('retries quoted searches once with plain keywords (final HTTP %s)', async status => {
  respond(202)
  respond(202)
  respond(202)
  respond(status, '<a class="result-link" href="https://venue.example/">Venue</a>')
  const quoted = '"teatro"   “independiente”  Buenos Aires'
  const results = researchSearch(quoted)
  if (status === 200) await expect(results).resolves.toEqual([{ title: 'Venue', url: 'https://venue.example/' }])
  else await expect(results).rejects.toThrow('Web search is unavailable right now; use research on a known URL instead.')

  const original = new URLSearchParams({ q: quoted }).toString()
  const keywords = 'q=teatro+independiente+Buenos+Aires'
  expect(requests.map(({ url, method, body }) => [url, method, body])).toEqual([
    ['https://html.duckduckgo.com/html/', 'POST', original],
    [`https://lite.duckduckgo.com/lite/?${original}`, 'GET', undefined],
    ['https://html.duckduckgo.com/html/', 'POST', keywords],
    [`https://lite.duckduckgo.com/lite/?${keywords}`, 'GET', undefined],
  ])
})
