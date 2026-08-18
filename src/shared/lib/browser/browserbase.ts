/**
 * Browserbase helpers
 *
 * Cloud browser sessions for scraping sites that block datacenter IPs
 * (e.g. Meetup). Used by the Meetup scraper in production when
 * `BROWSERBASE_API_KEY` is set.
 */

import { Browserbase } from '@browserbasehq/sdk'
import { BROWSER_VIEWPORT } from './constants.ts'

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

/** Bound for the Browserbase session-creation API call. */
export const SESSION_CREATION_TIMEOUT_MS = 45_000

/** Bound for connecting to a session over the Chrome DevTools Protocol. */
export const CDP_CONNECT_TIMEOUT_MS = 30_000

/**
 * Race a promise against a timeout, preserving the promise's original error
 * when it rejects first. The timeout error is a distinct, clearly-labelled
 * failure that only surfaces when the operation exceeds the bound.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
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

  const session = await withTimeout(
    bb.sessions.create({
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
    }),
    SESSION_CREATION_TIMEOUT_MS,
    'Browserbase session creation'
  )

  return { sessionId: session.id, connectUrl: session.connectUrl }
}
