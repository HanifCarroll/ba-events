/**
 * Passline Browser Scraper
 *
 * Fetches Passline events by running the API request inside a Browserbase
 * cloud browser session.
 *
 * Passline's Cloudflare protection blocks plain server-side HTTP fetches to
 * `api.passline.com` because the blocking is IP/infrastructure-based (see
 * "Passline Trigger.dev Playwright Attempt (Failed)", decisions.md 2026-01-25,
 * now superseded). Browserbase sessions egress through a managed proxy network
 * (residential IPs) with captcha solving, so the request is not subject to
 * datacenter-IP blocking. This mirrors the Meetup scraper's Browserbase path.
 */
import { chromium } from 'playwright'
import { createBrowserbaseSession, withTimeout, CDP_CONNECT_TIMEOUT_MS } from '#shared/lib/browser/index.ts'
import { logger } from '#shared/lib/logger.ts'
import { PASSLINE_API_URL } from './api.ts'
import type { PasslineEvent } from './api.ts'

/** Bound for the in-page Passline API fetch. */
const IN_PAGE_FETCH_TIMEOUT_MS = 45_000

/**
 * Fetch all Passline events for Argentina from inside a Browserbase session.
 *
 * The request runs in the cloud browser's page context (`page.evaluate`), so it
 * egresses from Browserbase's network rather than the server's.
 */
export async function fetchPasslineEventsWithBrowserbase(): Promise<PasslineEvent[]> {
  const { sessionId, connectUrl } = await createBrowserbaseSession()
  logger.info('[passline] Browserbase session created', { sessionId })

  const browser = await chromium.connectOverCDP(connectUrl, {
    timeout: CDP_CONNECT_TIMEOUT_MS,
  })

  try {
    const ctx = browser.contexts()[0]
    const page = ctx.pages()[0] || (await ctx.newPage())

    // Warm up on passline.com to establish a real browsing context. Best-effort.
    try {
      await page.goto('https://www.passline.com', {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      })
    } catch (err) {
      logger.warn('[passline] Warm-up navigation failed (continuing)', {
        error: err instanceof Error ? err.message : String(err),
      })
    }

    const events = await withTimeout(
      page.evaluate(
        async (url: string): Promise<PasslineEvent[]> => {
          const res = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify({ country: 'argentina' }),
          })

          if (!res.ok) {
            throw new Error(`Passline API error: ${res.status} ${res.statusText}`)
          }

          const data = (await res.json()) as { BillboardByCountry?: PasslineEvent[] }
          return data.BillboardByCountry || []
        },
        PASSLINE_API_URL
      ),
      IN_PAGE_FETCH_TIMEOUT_MS,
      'Passline in-page fetch'
    )

    logger.info('[passline] Fetched events via Browserbase', { count: events.length })
    return events
  } finally {
    await browser.close()
  }
}
