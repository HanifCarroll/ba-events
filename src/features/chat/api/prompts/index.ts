/**
 * System Prompt
 *
 * Single source for the concierge system prompt.
 */

import { conciergePrompt } from './concierge.ts'

export interface SystemPromptUserContext {
  isAuthenticated: boolean
  savedEventsCount: number
}

/**
 * Get the system prompt, with the current user's auth state injected
 * (previously the get_user_context tool — an extra model step per
 * conversation for static information).
 */
export function getSystemPrompt(
  userContext?: SystemPromptUserContext
): string {
  const base = conciergePrompt()
  if (!userContext) return base

  const block = userContext.isAuthenticated
    ? `\n\n## Current user\nThe user is logged in and has ${userContext.savedEventsCount} saved event${userContext.savedEventsCount === 1 ? '' : 's'}.`
    : '\n\n## Current user\nThe user is not logged in. If they clearly ask to save or unsave an event, still call the matching tool so its typed authentication receipt is recorded; never claim the mutation succeeded.'

  return base + block
}
