/**
 * Browser Connection Factory
 *
 * Creates browser connections that work with both Playwright (local development)
 * and Puppeteer/Browserless (production).
 *
 * The factory automatically selects the appropriate browser:
 * - If BROWSERLESS_TOKEN is set: Use Puppeteer with Browserless.io
 * - Otherwise: Use Playwright with local Chromium
 */

import type {
  BrowserConnection,
  BrowserConnectionOptions,
  BrowserContextOptions,
  PageWrapper,
} from './types'
import {
  BROWSER_USER_AGENT,
  BROWSER_VIEWPORT,
  DEFAULT_LOCALE,
  STEALTH_LAUNCH_ARGS,
  getBrowserlessEndpoint,
} from './constants'
import { sanitizeError } from '@/shared/lib/security'

/**
 * Create a browser connection.
 *
 * Automatically selects Browserless (production) or Playwright (development)
 * based on the presence of BROWSERLESS_TOKEN environment variable.
 *
 * @param options - Connection options
 * @returns A browser connection that can create pages
 *
 * @example
 * ```ts
 * const browser = await createBrowserConnection()
 * const page = await browser.newPage()
 * await page.goto('https://example.com')
 * // ... do work
 * await page.close()
 * await browser.close()
 * ```
 */
export async function createBrowserConnection(
  options: BrowserConnectionOptions = {}
): Promise<BrowserConnection> {
  const token = options.browserlessToken ?? process.env.BROWSERLESS_TOKEN

  // Determine browser type
  const type = options.type ?? (token ? 'puppeteer' : 'playwright')

  if (type === 'puppeteer' && token) {
    return createPuppeteerConnection(token)
  }

  return createPlaywrightConnection()
}

/**
 * Create a Puppeteer connection to Browserless.io
 */
async function createPuppeteerConnection(token: string): Promise<BrowserConnection> {
  const puppeteer = await import('puppeteer-core')

  let browser: Awaited<ReturnType<typeof puppeteer.default.connect>>

  try {
    browser = await puppeteer.default.connect({
      browserWSEndpoint: getBrowserlessEndpoint(token),
    })
  } catch (error) {
    console.error('[Browser] Failed to connect to Browserless:', sanitizeError(error))
    throw new Error('Failed to connect to browser service')
  }

  const connection: BrowserConnection = {
    type: 'puppeteer',
    puppeteerBrowser: browser,

    async close() {
      await browser.close()
    },

    async newContext() {
      // Puppeteer doesn't have contexts like Playwright
      // This is a no-op that returns a fake context
      throw new Error('Puppeteer does not support browser contexts. Use newPage() instead.')
    },

    async newPage(contextOptions: BrowserContextOptions = {}): Promise<PageWrapper> {
      const page = await browser.newPage()

      // Set user agent and viewport
      await page.setUserAgent(contextOptions.userAgent ?? BROWSER_USER_AGENT)
      await page.setViewport(contextOptions.viewport ?? BROWSER_VIEWPORT)

      return createPuppeteerPageWrapper(page)
    },
  }

  return connection
}

/**
 * Create a Playwright connection with local Chromium
 */
async function createPlaywrightConnection(): Promise<BrowserConnection> {
  const { chromium } = await import('playwright')

  const browser = await chromium.launch({
    headless: true,
    args: [...STEALTH_LAUNCH_ARGS],
  })

  const connection: BrowserConnection = {
    type: 'playwright',
    playwrightBrowser: browser,

    async close() {
      await browser.close()
    },

    async newContext(contextOptions: BrowserContextOptions = {}) {
      return browser.newContext({
        userAgent: contextOptions.userAgent ?? BROWSER_USER_AGENT,
        viewport: contextOptions.viewport ?? BROWSER_VIEWPORT,
        locale: contextOptions.locale ?? DEFAULT_LOCALE,
      })
    },

    async newPage(contextOptions: BrowserContextOptions = {}): Promise<PageWrapper> {
      const context = await browser.newContext({
        userAgent: contextOptions.userAgent ?? BROWSER_USER_AGENT,
        viewport: contextOptions.viewport ?? BROWSER_VIEWPORT,
        locale: contextOptions.locale ?? DEFAULT_LOCALE,
      })
      const page = await context.newPage()

      return createPlaywrightPageWrapper(page, context)
    },
  }

  return connection
}

/**
 * Create a PageWrapper for a Puppeteer page
 */
function createPuppeteerPageWrapper(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any
): PageWrapper {
  return {
    type: 'puppeteer',
    puppeteerPage: page,

    async goto(url: string, options?: { waitUntil?: string; timeout?: number }) {
      await page.goto(url, {
        waitUntil: (options?.waitUntil as 'networkidle0') ?? 'networkidle0',
        timeout: options?.timeout ?? 45000,
      })
    },

    async content() {
      return page.content()
    },

    async waitForSelector(selector: string, options?: { timeout?: number }) {
      await page.waitForSelector(selector, {
        timeout: options?.timeout ?? 15000,
      })
    },

    async waitForTimeout(ms: number) {
      await new Promise((resolve) => setTimeout(resolve, ms))
    },

    async close() {
      await page.close()
    },
  }
}

/**
 * Create a PageWrapper for a Playwright page
 */
function createPlaywrightPageWrapper(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: any
): PageWrapper {
  return {
    type: 'playwright',
    playwrightPage: page,
    context,

    async goto(url: string, options?: { waitUntil?: string; timeout?: number }) {
      await page.goto(url, {
        waitUntil: (options?.waitUntil as 'domcontentloaded') ?? 'domcontentloaded',
        timeout: options?.timeout ?? 30000,
      })
    },

    async content() {
      return page.content()
    },

    async waitForSelector(selector: string, options?: { timeout?: number; state?: string }) {
      await page.waitForSelector(selector, {
        timeout: options?.timeout ?? 15000,
        state: (options?.state as 'attached') ?? 'attached',
      })
    },

    async waitForTimeout(ms: number) {
      await page.waitForTimeout(ms)
    },

    async close() {
      await page.close()
      await context.close()
    },
  }
}

/**
 * Check if Browserless is available (BROWSERLESS_TOKEN is set)
 */
export function isBrowserlessAvailable(): boolean {
  return !!process.env.BROWSERLESS_TOKEN
}

/**
 * Get the current browser mode based on environment
 */
export function getBrowserMode(): 'browserless' | 'playwright' {
  return isBrowserlessAvailable() ? 'browserless' : 'playwright'
}
