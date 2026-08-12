/**
 * Browser Automation Constants
 *
 * Shared constants used across all browser automation scrapers.
 * These settings help pages appear more like real browser sessions.
 */

/**
 * Standard user agent string for browser automation.
 * Mimics a real Chrome browser on macOS.
 */
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/**
 * Standard viewport size for browser automation.
 * Uses common desktop resolution.
 */
export const BROWSER_VIEWPORT = {
  width: 1920,
  height: 1080,
} as const

/**
 * Launch arguments for stealth mode.
 * Helps avoid bot detection and frame detachment issues.
 *
 * --disable-features=site-per-process is a workaround for the Chromium
 * "Navigating frame was detached" bug that occurs with dynamic iframes.
 * See: https://github.com/puppeteer/puppeteer/issues/5123
 */
export const STEALTH_LAUNCH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-features=site-per-process',
] as const

/**
 * Default locale for browser context.
 * Set to Spanish (Argentina) for Buenos Aires event sites.
 */
export const DEFAULT_LOCALE = 'es-AR'
