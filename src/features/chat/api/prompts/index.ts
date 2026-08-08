/**
 * System Prompt
 *
 * Single source for the concierge system prompt.
 */

import { conciergePrompt } from './concierge'

/**
 * Get the system prompt for the given locale.
 */
export function getSystemPrompt(locale: 'en' | 'es'): string {
  return conciergePrompt(locale)
}
