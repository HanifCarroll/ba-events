import { launch, type BrowserWorker } from '@cloudflare/playwright'
import type { OpenBrowser } from '#features/import/acquisition/run.ts'
import { createBrowserRelease } from '#shared/lib/browser/release.ts'

/** Browser Rendering session owned by one acquisition run; release closes it exactly once. */
export function cloudflareBrowser(binding: BrowserWorker, source: string, keepAlive = 120_000): OpenBrowser {
  return async () => {
    // keep_alive covers Meetup's per-day page waits; release closes the session.
    const browser = await launch(binding, { keep_alive: keepAlive })
    const sessionId = browser.sessionId()
    console.info('[acquisition] Cloudflare browser acquired', { sessionId, source })
    const close = createBrowserRelease(async () => {
      await browser.close()
      console.info('[acquisition] Cloudflare browser released', { sessionId, source })
    })
    return { browser, close, openedAt: Date.now(), pagesUsed: 0 }
  }
}
