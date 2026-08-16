/**
 * Guest chat debug persistence.
 *
 * Saves a server-side copy of a guest (not signed-in) concierge chat to the
 * `guest_chat_debug` table so Hanif can look it up by conversation id when
 * something breaks. Guests otherwise persist only in the browser (Dexie), so
 * the server has no record of their chat.
 *
 * This is a debug aid, not a feature: it must never fail the chat response.
 * Every error is swallowed and logged with `logger.warn`. The table has no RLS
 * policies, so only the service-role client can read or write it.
 */

import { getSupabaseServiceRoleClient } from '#shared/lib/db/service.server.ts'
import { logger } from '#shared/lib/logger.ts'

import type { UIMessage } from 'ai'
import type { MessageExecutionStep } from '#shared/lib/types.ts'

export type GuestDebugAssistantMessage = {
  id: string
  role: 'assistant'
  parts: Array<{ type: 'text'; text: string }>
  executionTrace?: MessageExecutionStep[]
  error?: string
}

export async function persistGuestChatDebug(input: {
  conversationId: string | null
  locale: 'en' | 'es'
  ip: string
  messages: unknown
  lastUserText: string | null
}): Promise<void> {
  if (!input.conversationId) return

  await upsertGuestChatDebug({
    conversationId: input.conversationId,
    locale: input.locale,
    ip: input.ip,
    messages: input.messages,
    lastUserText: input.lastUserText,
  })
}

export function buildGuestDebugTranscript(
  uiMessages: UIMessage[],
  assistant: GuestDebugAssistantMessage
): unknown[] {
  return [...uiMessages, assistant]
}

export async function upsertGuestChatDebug(input: {
  conversationId: string
  locale: 'en' | 'es'
  ip: string
  messages: unknown
  lastUserText: string | null
}): Promise<void> {
  if (!input.conversationId) {
    return
  }

  try {
    const client = getSupabaseServiceRoleClient()
    const { error } = await client.from('guest_chat_debug').upsert(
      {
        conversation_id: input.conversationId,
        locale: input.locale,
        ip: input.ip,
        messages: input.messages,
        last_user_text: input.lastUserText,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'conversation_id' }
    )

    if (error) {
      logger.warn('[guest-debug] Failed to persist guest chat debug row', {
        conversationId: input.conversationId,
        error: error.message,
      })
    }
  } catch (error) {
    logger.warn('[guest-debug] Failed to persist guest chat debug row', {
      conversationId: input.conversationId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
