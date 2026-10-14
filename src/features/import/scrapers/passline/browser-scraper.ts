import { openPasslineBrowser } from '#shared/lib/browser/managed.ts'
import { reuseCatalogAcquisition, withTemporaryBrowser, type CatalogAcquisition } from '../../acquisition/run.ts'
import { collectPasslinePages, PASSLINE_API_URL, type PasslineEvent } from './api.ts'

/** Published country pagination, validated to an empty terminal page. */
export async function fetchPasslineEventsWithBrowserbase(): Promise<PasslineEvent[]> {
  return (await fetchPasslineCatalogWithBrowserbase()).events
}

export async function fetchPasslineCatalogWithBrowserbase(): Promise<CatalogAcquisition<PasslineEvent>> {
  return reuseCatalogAcquisition('passline:catalog:v1:argentina', () =>
    withTemporaryBrowser(() => openPasslineBrowser(false), async browser => {
      const context = browser.contexts()[0]
      await context.addCookies([
        { name: 'country', value: 'argentina', domain: '.passline.com', path: '/' },
        { name: 'language', value: 'es_ES', domain: '.passline.com', path: '/' },
      ])
      const page = await context.newPage()
      try {
        await page.goto('https://home.passline.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 })
        return await collectPasslinePages(async (offset, size) => {
          // String evaluation avoids bundler-generated helpers in Chromium.
          const script = `(async () => {
            const response = await fetch(${JSON.stringify(PASSLINE_API_URL)}, {
              method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
              body: JSON.stringify({ country: 'argentina', limit: '${offset},${size}' }),
              signal: AbortSignal.timeout(30000)
            });
            if (!response.ok) throw new Error('Passline HTTP ' + response.status);
            return response.json();
          })()`
          return page.evaluate(script)
        })
      } finally { await page.close().catch(() => {}) }
    })
  )
}
