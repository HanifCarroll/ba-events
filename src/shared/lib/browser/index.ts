/**
 * Browser Automation Utilities
 *
 * Unified browser automation utilities for web scraping across the application.
 * Supports both Playwright (local development) and Browserless.io (production).
 *
 * @example
 * ```ts
 * import {
 *   createBrowserConnection,
 *   isCloudflareChallenge,
 *   waitForCloudflareResolution,
 * } from '@/shared/lib/browser'
 *
 * const browser = await createBrowserConnection()
 * const page = await browser.newPage()
 *
 * await page.goto('https://example.com')
 *
 * const result = await waitForCloudflareResolution(page, {
 *   successSelector: '#content',
 * })
 *
 * if (result.success) {
 *   const html = await page.content()
 *   // Process page...
 * }
 *
 * await page.close()
 * await browser.close()
 * ```
 */

// Connection factory
export {
  createBrowserConnection,
  isBrowserlessAvailable,
  getBrowserMode,
} from './connection'

// Cloudflare utilities
export {
  isCloudflareChallenge,
  waitForCloudflareResolution,
} from './cloudflare'

// Constants
export {
  BROWSER_USER_AGENT,
  BROWSER_VIEWPORT,
  STEALTH_LAUNCH_ARGS,
  DEFAULT_LOCALE,
  getBrowserlessEndpoint,
} from './constants'

// Types
export type {
  BrowserType,
  BrowserConnection,
  BrowserConnectionOptions,
  BrowserContextOptions,
  CloudflareRetryOptions,
  CloudflareWaitResult,
  PageWrapper,
} from './types'
