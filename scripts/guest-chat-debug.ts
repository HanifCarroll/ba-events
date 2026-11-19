#!/usr/bin/env bun
/**
 * Look up a guest chat debug transcript by conversation id.
 *
 * Usage:
 *   bun scripts/guest-chat-debug.ts <conversationId>
 *
 * Reads D1 through bin/ba-d1-read.sh. Output contains private chat content.
 */

import { readD1, type ReadD1 } from './read-d1.ts'

interface GuestChatDebugRow {
  conversation_id: string
  locale: string | null
  messages: string
  last_user_text: string | null
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

export async function readGuestChat(read: ReadD1, conversationId: string) {
  const [row] = await read<GuestChatDebugRow>(
    'SELECT conversation_id, locale, messages, last_user_text, updated_at FROM guest_chat_debug WHERE conversation_id = ?',
    [conversationId],
  )
  if (!row) return null
  const messages: unknown = JSON.parse(row.messages)
  return { ...row, messages: Array.isArray(messages) ? messages as DebugMessage[] : [] }
}

async function main() {
  const args = process.argv.slice(2)
  const conversationId = args.find(arg => arg !== '--staging')
  if (!conversationId) throw new Error('Usage: bun scripts/guest-chat-debug.ts <conversationId> [--staging]')
  const row = await readGuestChat(readD1(args.includes('--staging')), conversationId)
  if (!row) throw new Error('No guest chat debug record found for that conversation id')

  console.log(`conversation_id: ${row.conversation_id}`)
  console.log(`updated_at: ${row.updated_at}`)
  console.log(`locale: ${row.locale ?? '(none)'}`)
  console.log(`last_user_text: ${row.last_user_text ?? '(none)'}`)

  const { messages } = row
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

if (import.meta.main) main().catch((error) => {
  console.error('Guest chat lookup failed:', error instanceof Error && !('cmd' in error) ? error.message : 'check D1 read access')
  process.exit(1)
})
