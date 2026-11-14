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
 * Exit code 0 = assistant produced text; 1 = HTTP/stream failure or empty reply.
 */

import { randomUUID } from 'crypto'

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
const locale = args.locale ?? 'en'

if (!url || !prompt) {
  console.error('Usage: bun scripts/chat-smoke.ts --url <base> --prompt "<text>" [--locale en|es]')
  process.exit(1)
}

const body = {
  locale,
  messages: [
    {
      id: randomUUID(),
      role: 'user',
      parts: [{ type: 'text', text: prompt }],
    },
  ],
}

const res = await fetch(`${url}/api/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
  body: JSON.stringify(body),
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
    // This route reports tool calls inside the execution-trace envelope.
    const envelope = evt.data as { data?: Array<{ toolCalls?: unknown[] }> } | undefined
    for (const step of envelope?.data ?? []) {
      for (const call of step.toolCalls ?? []) {
        const c = call as { toolName?: string; input?: unknown }
        toolCalls++
        console.log(`  [tool] ${c.toolName ?? '?'} args=${JSON.stringify(c.input ?? {})}`)
      }
    }
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
console.log(`[finish] ${finishReason ?? 'stream ended'} | tool calls: ${toolCalls}`)

if (!assistantText.trim()) process.exit(1)
