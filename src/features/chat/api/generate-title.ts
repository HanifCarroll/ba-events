/**
 * Generate Title API
 *
 * Uses Claude Haiku to generate a concise title for a conversation
 * based on the first user message.
 */

import { createServerFn } from '@tanstack/react-start'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic()

/**
 * Generate a title for a conversation based on the first user message.
 * Returns a short (3-6 word) descriptive title.
 */
export const generateTitle = createServerFn({ method: 'POST' })
  .inputValidator((data: { firstMessage: string; conversationId?: string }) => data)
  .handler(async ({ data }) => {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-20250514',
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
        return { title: 'New conversation' }
      }

      // Clean up the title
      let title = textContent.text.trim()

      // Remove quotes if present
      title = title.replace(/^["']|["']$/g, '')

      // Truncate if too long (max 60 chars)
      if (title.length > 60) {
        title = title.slice(0, 57) + '...'
      }

      // Fallback if empty
      if (!title) {
        title = 'New conversation'
      }

      return { title }
    } catch (error) {
      console.error('[generateTitle] Error:', error)
      // Don't throw - just return a default title
      return { title: 'New conversation' }
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
