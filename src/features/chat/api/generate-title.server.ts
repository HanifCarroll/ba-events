/**
 * Generate Title API
 *
 * Uses the configured text model (DeepSeek V4 Flash by default) to generate
 * a concise title for a conversation based on the first user message.
 */

import { generateText } from 'ai'
import type { RequestEvent } from '@sveltejs/kit'
import { NO_THINKING, textModel } from '#shared/lib/ai/providers.ts'
import {
  getFallbackConversationTitle,
  normalizeConversationTitle,
} from '#features/chat/lib/title.ts'
import { createSupabaseServerClient } from '#shared/lib/db/server-client.server.ts'

/**
 * Core title generation, shared by the server function and evals.
 * Returns a short (3-6 word) descriptive title, or a fallback on failure.
 */
export async function generateConversationTitle(firstMessage: string): Promise<string> {
  const fallbackTitle = getFallbackConversationTitle(firstMessage)

  try {
    const { text } = await generateText({
      model: textModel,
      prompt: `Generate a short, descriptive title (3-6 words) for a conversation that starts with this message. Return only the title, no quotes or punctuation. If the message is in Spanish, the title must be in Spanish. If the message is in English, the title must be in English.

Message: "${firstMessage}"`,
      ...NO_THINKING,
    })

    // Clean up the title
    const title = normalizeConversationTitle(text)

    // Fallback if empty
    if (!title) {
      return fallbackTitle
    }

    return title
  } catch (error) {
    console.error('[generateTitle] Error:', error)
    // Don't throw - just return a default title
    return fallbackTitle
  }
}

/**
 * Generate a title for a conversation based on the first user message.
 * Returns a short (3-6 word) descriptive title.
 */
export async function generateTitle(data: {
  firstMessage: string
  conversationId?: string
}) {
  return { title: await generateConversationTitle(data.firstMessage) }
}

/**
 * Generate a title and update the conversation.
 * Combines title generation with database update in one call.
 */
export async function generateAndSaveTitle(
  event: RequestEvent,
  data: { conversationId: string; firstMessage: string }
) {
  const supabase = createSupabaseServerClient(event)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Not authenticated')
  }

  // Generate the title
  const { title } = await generateTitle({ firstMessage: data.firstMessage })

  // Update the conversation
  const { error } = await supabase
    .from('conversations')
    .update({ title, updated_at: new Date().toISOString() })
    .eq('id', data.conversationId)
    .eq('user_id', user.id)

  if (error) {
    console.error('[generateAndSaveTitle] Error updating conversation:', error)
    // Don't throw - title generation worked, just saving failed
  }

  return { title }
}
