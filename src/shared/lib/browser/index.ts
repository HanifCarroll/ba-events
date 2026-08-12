/**
 * Browser Automation Utilities
 *
 * Cloud browser and Cloudflare utilities used by the event scrapers.
 * Playwright is used directly by each scraper (via `playwright` imports),
 * and Browserbase provides managed cloud browsers for sites that block
 * datacenter IPs (Meetup, Passline).
 */

// Cloudflare utilities
export { isCloudflareChallenge } from './cloudflare'

// Browserbase (cloud browser) helpers
export { isBrowserbaseAvailable, createBrowserbaseSession } from './browserbase'

// Constants
export {
  BROWSER_USER_AGENT,
  BROWSER_VIEWPORT,
  STEALTH_LAUNCH_ARGS,
  DEFAULT_LOCALE,
} from './constants'
