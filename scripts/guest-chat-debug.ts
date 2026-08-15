#!/usr/bin/env bun
/**
 * Look up a guest chat debug transcript by conversation id.
 *
 * Usage:
 *   bun scripts/guest-chat-debug.ts <conversationId>
 *
 * Reads through the service-role client (SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY from .env). Prints updated_at, locale,
 * last_user_text, and each message role + text. Exits 1 if not found.
 */

import { getSupabaseServiceRoleClient } from '#shared/lib/db/service.server.ts'

interface GuestChatDebugRow {
  conversation_id: string
  locale: string | null
  ip: string | null
  messages: unknown
  last_user_text: string | null
  created_at: string
  updated_at: string
}

interface DebugMessage {
  role?: string
  parts?: Array<{ type?: string; text?: string }>
  content?: string
  error?: string
  executionTrace?: Array<{
    stepIndex?: number
    stepType?: string
    text?: string
    reasoning?: string
    finishReason?: string
    toolCalls?: Array<{ toolName?: string; input?: unknown }>
    toolResults?: Array<{ toolName?: string; success?: boolean; output?: unknown }>
  }>
}

function extractVisibleText(message: DebugMessage): string {
  if (Array.isArray(message.parts)) {
    const text = message.parts
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('')
    if (text.trim().length > 0) return text
  }

  if (typeof message.content === 'string' && message.content.trim().length > 0) {
    return message.content
  }

  return ''
}

async function main(): Promise<void> {
  const conversationId = process.argv[2]
  if (!conversationId) {
    console.error('Usage: bun scripts/guest-chat-debug.ts <conversationId>')
    process.exit(1)
  }

  const client = getSupabaseServiceRoleClient()
  const { data, error } = await client
    .from('guest_chat_debug')
    .select('*')
    .eq('conversation_id', conversationId)
    .maybeSingle()

  if (error) {
    console.error(`Failed to look up guest chat: ${error.message}`)
    process.exit(1)
  }

  if (!data) {
    console.error(`No guest chat debug record found for conversation id: ${conversationId}`)
    process.exit(1)
  }

  const row = data as GuestChatDebugRow
  console.log(`conversation_id: ${row.conversation_id}`)
  console.log(`updated_at: ${row.updated_at}`)
  console.log(`locale: ${row.locale ?? '(none)'}`)
  console.log(`last_user_text: ${row.last_user_text ?? '(none)'}`)

  const messages = Array.isArray(row.messages) ? (row.messages as DebugMessage[]) : []
  console.log(`messages (${messages.length}):`)
  for (const message of messages) {
    const role = message.role ?? '(unknown)'
    const text = extractVisibleText(message)
    const error = typeof message.error === 'string' ? ` ERROR=${message.error}` : ''
    console.log(`  [${role}] ${text || '(no text)'}${error}`)
    if (Array.isArray(message.executionTrace)) {
      for (const step of message.executionTrace) {
        const calls = (step.toolCalls ?? [])
          .map((call) => `${call.toolName ?? 'unknown'} ${JSON.stringify(call.input ?? {})}`)
          .join('; ')
        console.log(
          `    step ${step.stepIndex ?? '?'} type=${step.stepType ?? '?'} finish=${step.finishReason ?? '?'}${calls ? ` tools=${calls}` : ''}`
        )
        if (typeof step.reasoning === 'string' && step.reasoning.trim().length > 0) {
          console.log(`      reasoning: ${step.reasoning}`)
        }
        if (typeof step.text === 'string' && step.text.trim().length > 0) {
          console.log(`      thinking: ${step.text}`)
        }
      }
    }
  }
}

main().catch((error) => {
  console.error('Failed:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
