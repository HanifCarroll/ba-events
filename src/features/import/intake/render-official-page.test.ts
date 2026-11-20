import { expect, it } from 'vitest'
import type { Browser } from '@cloudflare/playwright'
import { officialPageRenderer } from './render-official-page.ts'

it('blocks every unauthorized browser navigation before following it and still releases the browser', async () => {
  const start = 'https://tickets.example.org/event'
  const blocked = 'https://example.queue-it.net/?event=synthetic'
  const actions: [string, unknown][] = []
  type Pause = (event: { requestId: string; request: { url: string; method: string }; resourceType: string; frameId: string }) => void
  let pause!: Pause
  let cookie: string | undefined
  const sentCookies: Array<string | undefined> = []
  const cdp = {
    on: (event: string, callback: Pause) => { if (event === 'Fetch.requestPaused') pause = callback },
    send: async (method: string, params?: unknown) => {
      actions.push([method, params])
      if (method === 'Network.clearBrowserCookies') cookie = undefined
      if (method === 'Fetch.continueRequest') sentCookies.push(cookie)
      return method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'main' } } } : undefined
    },
  }
  const page = {
    context: () => ({ newCDPSession: async () => cdp }),
    goto: async () => {
      pause({ requestId: 'first', request: { url: start, method: 'GET' }, resourceType: 'Document', frameId: 'main' })
      await Promise.resolve()
      cookie = 'synthetic=1' // The first response sets a cookie before the allowed redirect and hydration.
      pause({ requestId: 'allowed-hop', request: { url: `${start}/detail`, method: 'GET' }, resourceType: 'Document', frameId: 'main' })
      pause({ requestId: 'preflight', request: { url: 'https://assets.example.net/data', method: 'OPTIONS' }, resourceType: 'XHR', frameId: 'main' })
      pause({ requestId: 'write', request: { url: start, method: 'POST' }, resourceType: 'XHR', frameId: 'main' })
      await Promise.resolve()
      pause({ requestId: 'redirect', request: { url: blocked, method: 'GET' }, resourceType: 'Document', frameId: 'main' })
      throw new Error('Navigation blocked')
    },
  }
  let closed = false
  const render = officialPageRenderer(async () => ({ browser: { newPage: async () => page } as unknown as Browser,
    close: async () => { closed = true }, openedAt: 0, pagesUsed: 0 }))
  await expect(render(start, new Set(['example.org']), [/fecha sintetica/u])).rejects.toThrow('waiting room')
  expect(actions).toContainEqual(['Fetch.continueRequest', { requestId: 'first' }])
  expect(actions).toContainEqual(['Fetch.continueRequest', { requestId: 'preflight' }])
  expect(actions).toContainEqual(['Fetch.continueRequest', { requestId: 'allowed-hop' }])
  expect(sentCookies).toEqual([undefined, undefined, undefined])
  expect(actions).toContainEqual(['Fetch.failRequest', { requestId: 'write', errorReason: 'BlockedByClient' }])
  expect(actions).toContainEqual(['Fetch.failRequest', { requestId: 'redirect', errorReason: 'BlockedByClient' }])
  expect(actions).not.toContainEqual(['Fetch.continueRequest', { requestId: 'redirect' }])
  expect(closed).toBe(true)
})
