/**
 * Cloudflare Detection Utilities
 *
 * Utilities for detecting Cloudflare challenge pages.
 * Used by browser scrapers to determine if a page load was blocked.
 */

/**
 * Cloudflare challenge indicators in HTML content.
 * These strings indicate the page is showing a Cloudflare challenge.
 */
const CLOUDFLARE_INDICATORS = [
  '__cf_chl', // Cloudflare challenge token
  'challenge-platform', // Cloudflare challenge platform
  'turnstile', // Cloudflare Turnstile challenge
  'Just a moment...', // Common Cloudflare waiting message
] as const

/**
 * Check if HTML content indicates a Cloudflare challenge page.
 *
 * @param html - The HTML content to check
 * @returns true if the page appears to be a Cloudflare challenge
 */
export function isCloudflareChallenge(html: string): boolean {
  return CLOUDFLARE_INDICATORS.some((indicator) => html.includes(indicator))
}
