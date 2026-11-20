import { expect, it } from 'vitest'
import type { Browser, BrowserContext, Request, Route } from '@cloudflare/playwright'
import { officialPageRenderer } from './render-official-page.ts'

it('isolates site cookies between renders and blocks unauthorized requests', async () => {
  const start = 'https://tickets.example.org/event'
  const blocked = 'https://example.queue-it.net/?event=synthetic'
  const actions: [string, { requestId?: string } | undefined][] = []
  type Pause = (event: { requestId: string; request: { url: string; method: string }; resourceType: string; frameId: string }) => void
  const sentCookies: Array<[string | undefined, string | undefined]> = []
  let closed = 0
  const newPage = async (options: unknown) => {
    // No storageState, HTTP credentials, or extra headers are imported into Browser.newPage's new context.
    expect(options).toEqual({ locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires', serviceWorkers: 'block', acceptDownloads: false })
    let pause!: Pause
    let cookie: string | undefined
    const cdp = {
      on: (event: string, callback: Pause) => { if (event === 'Fetch.requestPaused') pause = callback },
      send: async (method: string, params?: { requestId?: string }) => {
        actions.push([method, params])
        if (method === 'Network.clearBrowserCookies') cookie = undefined
        if (method === 'Fetch.continueRequest') sentCookies.push([params?.requestId, cookie])
        return method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'main' } } } : undefined
      },
    }
    let guard!: Parameters<BrowserContext['route']>[1]
    const page = {
      context: () => ({ newCDPSession: async () => cdp, route: async (_pattern: string, handler: typeof guard) => { guard = handler } }),
      goto: async () => {
        const probe = { continue: async () => 'continued', abort: async (reason: string) => reason } as unknown as Route
        const request = { frame: () => ({ page: () => page }) } as unknown as Request
        const popup = { frame: () => { throw new Error('Frame not created yet') } } as unknown as Request
        expect(await guard(probe, request)).toBe('continued')
        expect(await guard(probe, popup)).toBe('blockedbyclient')
        pause({ requestId: 'first', request: { url: start, method: 'GET' }, resourceType: 'Document', frameId: 'main' })
        await Promise.resolve()
        cookie = 'synthetic=1' // The first response sets a cookie before the allowed redirect.
        pause({ requestId: 'allowed-hop', request: { url: `${start}/detail`, method: 'GET' }, resourceType: 'Document', frameId: 'main' })
        pause({ requestId: 'preflight', request: { url: 'https://assets.example.net/data', method: 'OPTIONS' }, resourceType: 'XHR', frameId: 'main' })
        pause({ requestId: 'write', request: { url: start, method: 'POST' }, resourceType: 'XHR', frameId: 'main' })
        pause({ requestId: 'iframe', request: { url: start, method: 'GET' }, resourceType: 'Document', frameId: 'child' })
        await Promise.resolve()
        pause({ requestId: 'redirect', request: { url: blocked, method: 'GET' }, resourceType: 'Document', frameId: 'main' })
        throw new Error('Navigation blocked')
      },
    }
    return page
  }
  const render = officialPageRenderer(async () => ({ browser: { newPage } as unknown as Browser,
    close: async () => { closed++ }, openedAt: 0, pagesUsed: 0 }))
  for (let verification = 0; verification < 2; verification++) {
    await expect(render(start, new Set(['example.org']), [/fecha sintetica/u])).rejects.toThrow('waiting room')
  }
  // Each first request starts clean; a site cookie can accompany the next request in that context.
  expect(sentCookies.filter(([id]) => id !== 'preflight')).toEqual([
    ['first', undefined], ['allowed-hop', 'synthetic=1'], ['first', undefined], ['allowed-hop', 'synthetic=1'],
  ])
  expect([...new Set(actions.map(([method]) => method))]).toEqual(['Page.getFrameTree', 'Fetch.enable', 'Fetch.continueRequest', 'Fetch.failRequest'])
  const continued = ['first', 'allowed-hop', 'preflight']
  expect(actions.filter(([method]) => method === 'Fetch.continueRequest'))
    .toEqual([...continued, ...continued].map(requestId => ['Fetch.continueRequest', { requestId }])) // No injected credentials or other header overrides.
  for (const requestId of ['write', 'iframe', 'redirect']) {
    expect(actions).toContainEqual(['Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }])
  }
  expect(closed).toBe(2)
})
