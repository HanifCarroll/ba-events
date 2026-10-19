#!/usr/bin/env bun
/** Controlled dispatch simulation through the real delivery owner; no external I/O. */
import { ChatDelivery, type ChatDeliveryEnv } from '../src/chat-delivery-worker/index.ts'
import { adaptStoredMessageToCanonical } from '../src/features/chat/lib/canonical.ts'
import { deliveryHeaders, DELIVERY_OWNER_HEADER, DELIVERY_TURN_HEADER } from '../src/features/chat/lib/delivery-protocol.ts'
import { EXECUTION_STAGE_HEADER, workflowRequest } from '../src/chat-delivery-worker/recovery.ts'
import { verifyChatExecution } from '../src/features/chat/api/delivery-auth.server.ts'
import { mkdir, writeFile } from 'node:fs/promises'

const injected = { admissionMs: 10, workflowDispatchMs: 60, generationMs: 120 }
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`

async function trial(early: boolean) {
  const values = new Map<string, unknown>(), tasks: Promise<unknown>[] = []
  let generations = 0, commits = 0, admitted = 0, generationStart = 0, firstUseful = 0
  const id = { turnId: crypto.randomUUID(), attemptId: crypto.randomUUID(), token: 'f'.repeat(64) }
  const name = `${id.turnId}:${id.attemptId}`
  const canonical = adaptStoredMessageToCanonical({ id: 'fixture-answer', content: 'Fixture answer' })
  let object!: ChatDelivery
  const control = async (stage: 'generate' | 'commit') => object.fetch(await workflowRequest('fixture-secret', name, 'run', stage))
  const env: ChatDeliveryEnv = {
    CHAT_DELIVERY_SECRET: 'fixture-secret',
    ...(early ? { CHAT_EXPERIMENTAL_EARLY_GENERATION: 'after-admission' as const } : {}),
    CHAT_DELIVERY: { idFromName: value => value, get: () => ({ fetch: request => object.fetch(request) }) },
    CHAT_RESPONSE_WORKFLOW: {
      async create() {
        await delay(injected.admissionMs); admitted = performance.now()
        tasks.push((async () => {
          await delay(injected.workflowDispatchMs)
          const generated = await (await control('generate')).json() as { phase: string }
          if (generated.phase === 'running') await control('commit')
        })())
        return {}
      },
      async get() { return { status: async () => ({ status: 'running' }) } },
    },
    CHAT_EXECUTION: { async fetch(request) {
      if (!await verifyChatExecution(request.headers, 'fixture-secret')) throw new Error('Unsigned execution')
      if (request.headers.get(EXECUTION_STAGE_HEADER) === 'generate') {
        generations++; generationStart = performance.now()
        await delay(injected.generationMs)
        const checkpoint = await object.fetch(new Request('https://fixture/checkpoint', { method: 'POST', headers: request.headers,
          body: JSON.stringify({ canonical, executionTrace: [] }) }))
        if (checkpoint.status !== 204) throw new Error('Checkpoint rejected')
        return new Response(frame({ type: 'data-progress', transient: true, data: canonical }))
      }
      commits++
      const accepted = await object.fetch(new Request('https://fixture/commit', { method: 'POST', headers: request.headers }))
      if (accepted.status !== 204) throw new Error('Commit rejected')
      return new Response(frame({ type: 'data-response', data: canonical }) + frame({ type: 'finish', finishReason: 'stop' }))
    } },
  }
  object = new ChatDelivery({ storage: {
    async get<T>(key: string) { return structuredClone(values.get(key)) as T | undefined },
    async put(entries) { for (const [key, value] of Object.entries(entries)) values.set(key, structuredClone(value)) },
    async list<T>({ prefix }: { prefix: string }) { return new Map([...values].filter(([key]) => key.startsWith(prefix)).sort().map(([key, value]) => [key, structuredClone(value) as T])) },
    async setAlarm() {}, async deleteAll() { values.clear() }, async delete(keys) { keys.forEach(key => values.delete(key)) },
  }, waitUntil: task => { tasks.push(task) } }, env)
  const started = performance.now()
  const response = await object.fetch(new Request('https://fixture/start', { method: 'POST',
    headers: { ...deliveryHeaders(id), [DELIVERY_OWNER_HEADER]: 'guest', [DELIVERY_TURN_HEADER]: id.turnId }, body: '{"message":"fixture"}' }))
  const reader = response.body!.getReader(), decoder = new TextDecoder()
  let text = ''
  for (;;) {
    const chunk = await reader.read(); if (chunk.done) break
    text += decoder.decode(chunk.value, { stream: true })
    if (!firstUseful && text.includes('data-progress')) firstUseful = performance.now()
  }
  const completed = performance.now()
  await Promise.all(tasks)
  const publications = (text.match(/"type":"data-response"/g) ?? []).length
  if (generations !== 1 || commits !== 1 || publications !== 1 || generationStart < admitted) throw new Error('Ownership/admission invariant failed')
  return { mode: early ? 'after-admission' : 'workflow-dispatch', generations, commits, publications,
    admissionMs: admitted - started, postAdmissionStartMs: generationStart - admitted,
    firstUsefulMs: firstUseful - started, completionMs: completed - started }
}

const rows = []
for (let i = 0; i < 3; i++) for (const early of (i % 2 ? [true, false] : [false, true])) rows.push(await trial(early))
const receipt = { version: 'startup-dispatch-simulation-v1', measuredAt: new Date().toISOString(),
  environment: 'local Bun, in-memory storage, signed in-process bindings, artificial delays; not production latency',
  injected, externalRequests: 0, paidCalls: 0, productionSettingsChanged: false, rows }
const directory = 'results/releases/practitioner-chat-research-20261018'
await mkdir(directory, { recursive: true })
await writeFile(`${directory}/startup-simulation.json`, JSON.stringify(receipt, null, 2))
console.log(JSON.stringify(receipt, null, 2))
