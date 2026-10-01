import { chromium, type BrowserContext } from 'playwright'
import { Browserbase } from '@browserbasehq/sdk'
import { Schema } from 'effect'
import type { OwnedBrowser } from '#features/import/acquisition/run.ts'
import { BROWSER_VIEWPORT } from './constants.ts'

const creationSchema = Schema.Struct({ sessionId: Schema.String, webSocketDebuggerUrl: Schema.String })
const account = '38d9d25d890a220fb7cf6dd92f8a322a'

export function isCloudflareBrowserAvailable(): boolean {
  return Boolean(process.env.CLOUDFLARE_BROWSER_TOKEN || process.env.CLOUDFLARE_AUDIT_TOKEN)
}

export async function openCloudflareBrowser(): Promise<OwnedBrowser> {
  const token = process.env.CLOUDFLARE_BROWSER_TOKEN || process.env.CLOUDFLARE_AUDIT_TOKEN
  if (!token) throw new Error('Cloudflare Browser Rendering credential is missing')
  const base = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID || account}/browser-run/devtools/browser`
  const headers = { Authorization: `Bearer ${token}` }
  const response = await fetch(base + '?keep_alive=60000', { method: 'POST', headers, signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(`Cloudflare browser creation failed: HTTP ${response.status}`)
  const raw = await response.json() as { result?: unknown }
  const session = Schema.decodeUnknownSync(creationSchema)(raw.result ?? raw)
  let browser: OwnedBrowser['browser'] | undefined
  let releasePromise: Promise<void> | undefined
  const release = () => releasePromise ??= (async () => {
    const result = await fetch(`${base}/${session.sessionId}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(15000) })
    if (!result.ok && result.status !== 404) throw new Error(`Cloudflare browser release failed: HTTP ${result.status}`)
    await browser?.close().catch(() => {})
    const check = await fetch(base.replace('/browser-run/devtools/browser', '/browser-rendering/devtools/session'), { headers, signal: AbortSignal.timeout(15000) })
    if (!check.ok) throw new Error(`Cloudflare release verification failed: HTTP ${check.status}`)
    const body = await check.json() as { result?: unknown }
    const sessions = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ sessionId: Schema.String })))(body.result ?? body)
    if (sessions.some(active => active.sessionId === session.sessionId)) throw new Error('Cloudflare session remains active after release')
    console.info('[acquisition] Cloudflare browser released', { sessionId: session.sessionId, confirmedAbsent: true })
  })()
  try { browser = await chromium.connectOverCDP(session.webSocketDebuggerUrl, { headers, timeout: 30000 }) } catch (error) { await release(); throw error }
  console.info('[acquisition] Cloudflare browser acquired', { sessionId: session.sessionId, source: 'meetup' })
  return { browser, close: release, openedAt: Date.now(), pagesUsed: 0 }
}

export async function configurePasslineResources(context: BrowserContext, thin: boolean): Promise<void> {
  await context.route('**/*', route => {
    const request = route.request()
    const url = new URL(request.url())
    const tracker = ['googletagmanager.com', 'google-analytics.com', 'facebook.net', 'facebook.com', 'doubleclick.net']
      .some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain))
    const challenge = url.hostname === 'challenges.cloudflare.com' || url.pathname.startsWith('/cdn-cgi/')
    const blocked = ['image', 'font', 'media'].includes(request.resourceType()) || tracker
      || (thin && !challenge && ['script', 'stylesheet'].includes(request.resourceType()))
    return blocked ? route.abort() : route.continue()
  })
}

export async function openPasslineBrowser(thin = false): Promise<OwnedBrowser> {
  return openBrowserbaseBrowser('passline', thin)
}

export async function openBrowserbaseBrowser(source: 'passline' | 'meetup', thin = false): Promise<OwnedBrowser> {
  const sdk = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY })
  const session = await sdk.sessions.create({
    projectId: process.env.BROWSERBASE_PROJECT_ID || undefined,
    api_timeout: 900, keepAlive: false,
    browserSettings: { viewport: BROWSER_VIEWPORT, solveCaptchas: true },
    proxies: source === 'passline' ? [{ type: 'browserbase', domainPattern: '(^|.*\\.)passline\\.com$' }] : true,
    userMetadata: { source, stage: thin ? 'detail' : 'catalog', acquisitionVersion: '1' },
  }, { timeout: 45000 })
  let browser: OwnedBrowser['browser'] | undefined
  let releasePromise: Promise<void> | undefined
  const release = () => releasePromise ??= (async () => {
    let ended = await sdk.sessions.retrieve(session.id, { timeout: 15000 })
    if (!['COMPLETED', 'ERROR', 'TIMED_OUT'].includes(ended.status)) {
      await sdk.sessions.update(session.id, { projectId: session.projectId, status: 'REQUEST_RELEASE' }, { timeout: 15000 })
    }
    await browser?.close().catch(() => {})
    ended = await sdk.sessions.retrieve(session.id, { timeout: 15000 })
    for (let attempt = 0; !['COMPLETED', 'ERROR', 'TIMED_OUT'].includes(ended.status) && attempt < 4; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 500))
      ended = await sdk.sessions.retrieve(session.id, { timeout: 15000 })
    }
    console.info('[acquisition] Browserbase release metadata', { sessionId: session.id, status: ended.status, proxyBytes: ended.proxyBytes, usageMayBePending: ended.proxyBytes === 0 })
    if (!['COMPLETED', 'ERROR', 'TIMED_OUT'].includes(ended.status)) throw new Error('Browserbase release has not completed')
  })()
  try {
    browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30000 })
    if (source === 'passline') await configurePasslineResources(browser.contexts()[0], thin)
  } catch (error) { await release(); throw error }
  console.info('[acquisition] Browserbase acquired', { sessionId: session.id, source, thin })
  return { browser, close: release, openedAt: Date.now(), pagesUsed: 0 }
}
