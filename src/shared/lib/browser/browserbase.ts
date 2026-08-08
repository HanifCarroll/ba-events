/**
 * Browserbase helpers
 *
 * Cloud browser sessions for scraping sites that block datacenter IPs
 * (e.g. Meetup). Used by the Meetup scraper in production when
 * `BROWSERBASE_API_KEY` is set.
 */

import { Browserbase } from '@browserbasehq/sdk'
import { BROWSER_VIEWPORT } from './constants'

/**
 * Check if Browserbase is available (BROWSERBASE_API_KEY is set)
 */
export function isBrowserbaseAvailable(): boolean {
  return !!process.env.BROWSERBASE_API_KEY
}

export interface BrowserbaseSession {
  sessionId: string
  connectUrl: string
}

/**
 * Create a Browserbase session configured for Buenos Aires event scraping.
 *
 * The session uses Browserbase's managed proxy (so Meetup does not see a raw
 * datacenter IP) and a desktop viewport. Locale/timezone/geolocation emulation
 * is applied by the scraper via the Playwright context after connecting.
 */
export async function createBrowserbaseSession(): Promise<BrowserbaseSession> {
  const apiKey = process.env.BROWSERBASE_API_KEY
  if (!apiKey) {
    throw new Error('BROWSERBASE_API_KEY is not set')
  }

  const bb = new Browserbase({ apiKey })

  const session = await bb.sessions.create({
    projectId: process.env.BROWSERBASE_PROJECT_ID || undefined,
    browserSettings: {
      viewport: {
        width: BROWSER_VIEWPORT.width,
        height: BROWSER_VIEWPORT.height,
      },
      solveCaptchas: true,
    },
    // Use Browserbase's managed proxy network by default.
    proxies: true,
  })

  return { sessionId: session.id, connectUrl: session.connectUrl }
}
