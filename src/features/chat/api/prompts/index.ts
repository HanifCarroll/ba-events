/**
 * System Prompts Registry
 *
 * Centralized system prompt management with versioning.
 * Each prompt version is tracked for A/B testing and rollback capabilities.
 */

import { conciergePromptV1 } from './concierge-v1'

// ============================================================================
// PROMPT VERSIONS
// ============================================================================

export const PROMPT_VERSIONS = {
  'concierge-v1': conciergePromptV1,
} as const

export type PromptVersion = keyof typeof PROMPT_VERSIONS

// ============================================================================
// CURRENT ACTIVE PROMPT
// ============================================================================

/**
 * The currently active prompt version.
 * Change this to switch between prompt versions.
 */
export const ACTIVE_PROMPT_VERSION: PromptVersion = 'concierge-v1'

// ============================================================================
// PROMPT GETTER
// ============================================================================

/**
 * Get the system prompt for the given locale.
 * Uses the currently active prompt version.
 *
 * @param locale - The user's locale ('en' or 'es')
 * @returns The formatted system prompt string
 */
export function getSystemPrompt(locale: 'en' | 'es'): string {
  const promptFn = PROMPT_VERSIONS[ACTIVE_PROMPT_VERSION]
  return promptFn(locale)
}

/**
 * Get a specific prompt version (for A/B testing).
 *
 * @param version - The prompt version to use
 * @param locale - The user's locale
 * @returns The formatted system prompt string
 */
export function getSystemPromptByVersion(version: PromptVersion, locale: 'en' | 'es'): string {
  const promptFn = PROMPT_VERSIONS[version]
  return promptFn(locale)
}

// Re-export for convenience
export { conciergePromptV1 }
