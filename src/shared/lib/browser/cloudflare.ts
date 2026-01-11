/**
 * Cloudflare Detection & Handling Utilities
 *
 * Utilities for detecting and handling Cloudflare challenge pages.
 * Used by browser scrapers to determine if a page load was blocked.
 */

import type { CloudflareRetryOptions, CloudflareWaitResult, PageWrapper } from './types'

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

/**
 * Default options for Cloudflare retry logic
 */
const DEFAULT_RETRY_OPTIONS: Required<CloudflareRetryOptions> = {
  maxAttempts: 3,
  delayMs: 8000,
  successSelector: '',
  selectorTimeout: 15000,
}

/**
 * Wait for Cloudflare challenge to resolve with retry logic.
 *
 * This function attempts to wait for a specific selector to appear,
 * retrying if Cloudflare challenges are detected. It's designed for
 * use with Browserless.io which can often bypass Cloudflare challenges
 * automatically after a short delay.
 *
 * @param page - The page wrapper to check
 * @param options - Retry configuration options
 * @returns Result indicating success/failure and attempt count
 *
 * @example
 * ```ts
 * const result = await waitForCloudflareResolution(page, {
 *   successSelector: '#content',
 *   maxAttempts: 3,
 *   delayMs: 8000,
 * })
 * if (!result.success) {
 *   console.log('Cloudflare blocked after', result.attempts, 'attempts')
 * }
 * ```
 */
export async function waitForCloudflareResolution(
  page: PageWrapper,
  options: CloudflareRetryOptions = {}
): Promise<CloudflareWaitResult> {
  const config = { ...DEFAULT_RETRY_OPTIONS, ...options }

  // If no selector specified, just check if page isn't Cloudflare
  if (!config.successSelector) {
    const html = await page.content()
    const isBlocked = isCloudflareChallenge(html)
    return {
      success: !isBlocked,
      attempts: 1,
      error: isBlocked ? 'Cloudflare challenge detected' : undefined,
    }
  }

  let attempts = 0

  while (attempts < config.maxAttempts) {
    attempts++

    try {
      await page.waitForSelector(config.successSelector, {
        timeout: config.selectorTimeout,
      })
      // Success - selector found
      return { success: true, attempts }
    } catch {
      // Selector not found - check if it's a Cloudflare challenge
      const html = await page.content()
      const isBlocked = isCloudflareChallenge(html)

      if (isBlocked && attempts < config.maxAttempts) {
        // Wait and retry for Cloudflare to potentially auto-resolve
        console.log(
          `[Cloudflare] Challenge detected, waiting (attempt ${attempts}/${config.maxAttempts})...`
        )
        await delay(config.delayMs)
        continue
      }

      // Final failure
      return {
        success: false,
        attempts,
        error: isBlocked ? 'Cloudflare challenge not resolved' : 'Selector not found',
      }
    }
  }

  return {
    success: false,
    attempts,
    error: 'Max attempts reached',
  }
}

/**
 * Simple delay helper
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
