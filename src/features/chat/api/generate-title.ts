/**
 * Generate Title API
 *
 * Uses Claude Haiku to generate a concise title for a conversation
 * based on the first user message.
 */

import { createServerFn } from '@tanstack/react-start'
import Anthropic from '@anthropic-ai/sdk'
import { CLAUDE_MODEL } from '@/shared/lib/ai/constants'
import {
  getFallbackConversationTitle,
  normalizeConversationTitle,
} from '@/features/chat/lib/title'

const anthropic = new Anthropic()
export const TITLE_MODEL = CLAUDE_MODEL

/**
 * Generate a title for a conversation based on the first user message.
 * Returns a short (3-6 word) descriptive title.
 */
export const generateTitle = createServerFn({ method: 'POST' })
  .inputValidator((data: { firstMessage: string; conversationId?: string }) => data)
  .handler(async ({ data }) => {
    const fallbackTitle = getFallbackConversationTitle(data.firstMessage)

    try {
      const response = await anthropic.messages.create({
        model: TITLE_MODEL,
        max_tokens: 50,
        messages: [
          {
            role: 'user',
            content: `Generate a short, descriptive title (3-6 words) for a conversation that starts with this message. Return only the title, no quotes or punctuation.

Message: "${data.firstMessage}"`,
          },
        ],
      })

      // Extract the text from the response
      const textContent = response.content.find((c) => c.type === 'text')
      if (!textContent || textContent.type !== 'text') {
        return { title: fallbackTitle }
      }

      // Clean up the title
      const title = normalizeConversationTitle(textContent.text)

      // Fallback if empty
      if (!title) {
        return { title: fallbackTitle }
      }

      return { title }
    } catch (error) {
      console.error('[generateTitle] Error:', error)
      // Don't throw - just return a default title
      return { title: fallbackTitle }
    }
  })

/**
 * Generate a title and update the conversation.
 * Combines title generation with database update in one call.
 */
export const generateAndSaveTitle = createServerFn({ method: 'POST' })
  .inputValidator((data: { conversationId: string; firstMessage: string }) => data)
  .handler(async ({ data }) => {
    const { createSupabaseServerClient } = await import('@/shared/lib/db/server')
    const supabase = createSupabaseServerClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      throw new Error('Not authenticated')
    }

    // Generate the title
    const { title } = await generateTitle({ data: { firstMessage: data.firstMessage } })

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
  })
