#!/usr/bin/env bun
/**
 * Headless chat smoke test.
 *
 * Exercises the real POST /api/chat route (tools, model, streaming) without
 * the web UI. Reads the UIMessage SSE stream and prints a readable transcript.
 *
 * Usage:
 *   bun scripts/chat-smoke.ts --url https://baeventos.com --prompt "what's on tonight?"
 *   bun scripts/chat-smoke.ts --url http://localhost:3000 --prompt "techno in Palermo" --locale es
 *
 * Sends a guest turn in the current delivery protocol (client ids plus the x-chat-attempt/x-chat-token capability),
 * so it also works while DB_READ_ONLY=1 freezes signed-in writes.
 *
 * Exit code 0 = assistant produced text; 1 = HTTP/stream failure or empty reply, or no events with --require-events 1.
 */

import { randomUUID } from 'crypto'
import { DELIVERY_ATTEMPT_HEADER, DELIVERY_TOKEN_HEADER } from '../src/features/chat/lib/delivery-protocol.ts'

/** A guest turn as the browser starts one: client-made ids and a random delivery capability (delivery.ts). */
export function guestChatRequest(prompt: string, locale: 'en' | 'es') {
  const turnId = randomUUID()
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')
  const userClientMessageId = randomUUID()
  return {
    headers: {
      'Content-Type': 'application/json', Accept: 'text/event-stream',
      [DELIVERY_ATTEMPT_HEADER]: randomUUID(), [DELIVERY_TOKEN_HEADER]: token,
    },
    body: {
      locale, turnId, conversationId: randomUUID(), userClientMessageId, assistantClientMessageId: randomUUID(),
      messages: [{ id: userClientMessageId, role: 'user', parts: [{ type: 'text', text: prompt }] }],
    },
  }
}

if (import.meta.main) await main()

async function main() {
const args: Record<string, string> = {}
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    args[argv[i].slice(2)] = argv[i + 1] ?? ''
    i++
  }
}

const url = args.url
const prompt = args.prompt
const locale = args.locale === 'es' ? 'es' : 'en'

if (!url || !prompt) {
  console.error('Usage: bun scripts/chat-smoke.ts --url <base> --prompt "<text>" [--locale en|es]')
  process.exit(1)
}

const request = guestChatRequest(prompt, locale)
const res = await fetch(`${url}/api/chat`, {
  method: 'POST',
  headers: request.headers,
  body: JSON.stringify(request.body),
  signal: AbortSignal.timeout(120_000),
})

if (!res.ok || !res.body) {
  console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`)
  process.exit(1)
}

console.log(`> ${prompt}\n`)

const reader = res.body.getReader()
const decoder = new TextDecoder()
let buffer = ''
let assistantText = ''
let finishReason: string | null = null
let toolCalls = 0
let events = 0
let lastStatus = ''

function handleEvent(evt: Record<string, unknown>) {
  const type = evt.type as string
  if (type === 'text-delta') {
    assistantText += String(evt.delta ?? '')
  } else if (type === 'tool-call') {
    toolCalls++
    console.log(`  [tool] ${evt.toolName} args=${JSON.stringify(evt.args ?? {})}`)
  } else if (type === 'finish') {
    finishReason = String(evt.finishReason ?? 'unknown')
  } else if (type === 'data-execution-trace') {
    // Tool calls are reported inside the execution trace's steps.
    const trace = evt.data as { steps?: Array<{ toolCalls?: unknown[] }> } | undefined
    for (const step of trace?.steps ?? []) {
      for (const call of step.toolCalls ?? []) {
        const c = call as { toolName?: string; input?: unknown }
        toolCalls++
        console.log(`  [tool] ${c.toolName ?? '?'} args=${JSON.stringify(c.input ?? {})}`)
      }
    }
  } else if (type === 'data-response') {
    events = ((evt.data as { events?: unknown[] } | undefined)?.events ?? []).length
  } else if (type === 'data-status') {
    const phase = (evt.data as { phase?: string } | undefined)?.phase
    if (phase && phase !== lastStatus) {
      lastStatus = phase
      console.log(`  [status] ${phase}`)
    }
  }
}

while (true) {
  const { done, value } = await reader.read()
  if (done) break
  buffer += decoder.decode(value, { stream: true })
  let idx
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (!line.startsWith('data:')) continue
    const payload = line.slice(5).trim()
    if (!payload) continue
    try {
      handleEvent(JSON.parse(payload))
    } catch {
      // ignore non-JSON frames (heartbeats, etc.)
    }
  }
}

console.log(`\n[assistant] ${assistantText.trim() || '(no text)'}`)
console.log(`[finish] ${finishReason ?? 'stream ended'} | tool calls: ${toolCalls} | events: ${events}`)

if (!assistantText.trim() || (args['require-events'] !== undefined && events === 0)) process.exit(1)
}
