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
  parts?: Array<{ type?: string; text?: string; data?: DebugResponse }>
  content?: string
  error?: string
  executionTrace?: Array<{
    stepIndex?: number
    stepType?: string
    finishReason?: string
    toolCalls?: Array<{ toolCallId?: string; toolName?: string; input?: unknown }>
    toolResults?: Array<{ toolCallId?: string; toolName?: string; success?: boolean; output?: DebugToolOutput }>
  }>
}

interface DebugEvent { name?: string; starts_at?: string; time_tba?: boolean }
interface DebugToolOutput {
  success?: boolean
  error?: string
  events?: DebugEvent[]
  metadata?: { resultCount?: number; searchMode?: string; totalMatches?: number; coverage?: { totalMatches?: number } }
}
interface DebugResponse { events?: DebugEvent[]; suggestions?: unknown; searchContext?: unknown }

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

export function formatGuestDebugMessages(messages: DebugMessage[]): string[] {
  const lines = [`messages (${messages.length}):`]
  for (const message of messages) {
    const role = message.role ?? '(unknown)'
    const text = extractVisibleText(message)
    const error = typeof message.error === 'string' ? ` ERROR=${message.error}` : ''
    lines.push(`  [${role}] ${text || '(no text)'}${error}`)
    if (role !== 'assistant') continue
    if (!message.executionTrace?.length) lines.push('    executionTrace: (not recorded)')
    for (const step of message.executionTrace ?? []) {
      lines.push(`    step ${step.stepIndex ?? '?'} type=${step.stepType ?? '?'} finish=${step.finishReason ?? '?'}`)
      for (const [index, call] of (step.toolCalls ?? []).entries()) {
        const result = call.toolCallId
          ? step.toolResults?.find(result => result.toolCallId === call.toolCallId)
          : step.toolResults?.[index]
        const output = result?.output
        const metadata = output?.metadata
        const events = Array.isArray(output?.events) ? output.events : []
        lines.push(`      ${call.toolName ?? 'unknown'} input=${JSON.stringify(call.input ?? null)}`)
        lines.push(`        success=${result?.success ?? output?.success ?? 'unknown'} resultCount=${metadata?.resultCount ?? (result ? events.length : 'unknown')}${output?.error ? ` error=${output.error}` : ''}`)
        lines.push(`        searchMode=${metadata?.searchMode ?? '(none)'} totalMatches=${metadata?.totalMatches ?? metadata?.coverage?.totalMatches ?? '(none)'} coverage=${JSON.stringify(metadata?.coverage ?? null)}`)
        for (const event of events) lines.push(`        ${JSON.stringify(event.name ?? '(unnamed)')} starts_at=${event.starts_at ?? '(unknown)'} time_tba=${event.time_tba ?? 'unknown'}`)
      }
    }
    const response = Array.isArray(message.parts) ? message.parts.findLast(part => part.type === 'data-response')?.data : undefined
    lines.push(`    response events: ${JSON.stringify(Array.isArray(response?.events) ? response.events.map(event => event.name ?? '(unnamed)') : [])}`)
    lines.push(`    suggestions: ${JSON.stringify(response?.suggestions ?? [])}`)
    lines.push(`    searchContext: ${JSON.stringify(response?.searchContext ?? null)}`)
  }
  return lines
}

async function main() {
  const args = process.argv.slice(2)
  const conversationId = args.find(arg => arg !== '--staging')
  if (!conversationId) throw new Error('Usage: bun scripts/guest-chat-debug.ts <conversationId> [--staging]')
  const row = await readGuestChat(readD1(args.includes('--staging')), conversationId)
  if (!row) throw new Error('No guest chat debug record found for that conversation id')

  console.error('Warning: output contains private chat content.')
  console.log(`conversation_id: ${row.conversation_id}`)
  console.log(`updated_at: ${row.updated_at}`)
  console.log(`locale: ${row.locale ?? '(none)'}`)
  console.log(`last_user_text: ${row.last_user_text ?? '(none)'}`)

  console.log(formatGuestDebugMessages(row.messages).join('\n'))
}

if (import.meta.main) main().catch((error) => {
  console.error('Guest chat lookup failed:', error instanceof Error && !('cmd' in error) ? error.message : 'check D1 read access')
  process.exit(1)
})
