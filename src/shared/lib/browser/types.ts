/**
 * Browser Automation Types
 *
 * TypeScript interfaces for the unified browser automation utilities.
 */

import type { Browser, BrowserContext, Page } from 'playwright'
import type { Browser as PuppeteerBrowser, Page as PuppeteerPage } from 'puppeteer-core'

/**
 * Browser connection type - either Playwright (local) or Puppeteer (Browserless)
 */
export type BrowserType = 'playwright' | 'puppeteer'

/**
 * Options for creating a browser connection
 */
export interface BrowserConnectionOptions {
  /** Force a specific browser type instead of auto-detecting */
  type?: BrowserType
  /** Custom Browserless token (defaults to BROWSERLESS_TOKEN env var) */
  browserlessToken?: string
}

/**
 * Options for creating a browser context
 */
export interface BrowserContextOptions {
  /** Browser locale (defaults to 'es-AR') */
  locale?: string
  /** Custom user agent */
  userAgent?: string
  /** Custom viewport */
  viewport?: { width: number; height: number }
}

/**
 * Options for Cloudflare retry logic
 */
export interface CloudflareRetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number
  /** Delay between retries in milliseconds (default: 8000) */
  delayMs?: number
  /** Selector to wait for (indicates page loaded successfully) */
  successSelector?: string
  /** Timeout for selector wait in milliseconds (default: 15000) */
  selectorTimeout?: number
}

/**
 * Result of Cloudflare wait operation
 */
export interface CloudflareWaitResult {
  /** Whether the page loaded successfully (not blocked by Cloudflare) */
  success: boolean
  /** Number of attempts made */
  attempts: number
  /** Error message if failed */
  error?: string
}

/**
 * Unified browser connection interface
 *
 * Provides a consistent API for both Playwright and Puppeteer browsers.
 */
export interface BrowserConnection {
  /** The type of browser connection */
  type: BrowserType

  /** Close the browser connection */
  close(): Promise<void>

  /**
   * Create a new browser context (Playwright only)
   * For Puppeteer, use newPage() directly
   */
  newContext(options?: BrowserContextOptions): Promise<BrowserContext>

  /**
   * Create a new page
   * For Playwright, this creates a new context and page
   * For Puppeteer, this creates a new page directly
   */
  newPage(options?: BrowserContextOptions): Promise<PageWrapper>

  /** The underlying Playwright browser (if type is 'playwright') */
  playwrightBrowser?: Browser

  /** The underlying Puppeteer browser (if type is 'puppeteer') */
  puppeteerBrowser?: PuppeteerBrowser
}

/**
 * Wrapper around page that provides consistent API
 */
export interface PageWrapper {
  /** The page type */
  type: BrowserType

  /** Navigate to a URL */
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<void>

  /** Get page content */
  content(): Promise<string>

  /** Wait for a selector */
  waitForSelector(
    selector: string,
    options?: { timeout?: number; state?: string }
  ): Promise<void>

  /** Wait for a specified time */
  waitForTimeout(ms: number): Promise<void>

  /** Close the page */
  close(): Promise<void>

  /** The underlying Playwright page (if type is 'playwright') */
  playwrightPage?: Page

  /** The underlying Puppeteer page (if type is 'puppeteer') */
  puppeteerPage?: PuppeteerPage

  /** The browser context (Playwright only) */
  context?: BrowserContext
}
