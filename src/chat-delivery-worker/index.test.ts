import { describe, expect, it } from 'vitest'
import { ChatDelivery, type ChatDeliveryEnv } from './index.ts'
import { deliveryHeaders, DELIVERY_OWNER_HEADER, DELIVERY_TURN_HEADER } from '#features/chat/lib/delivery-protocol.ts'
import { verifyChatExecution } from '#features/chat/api/delivery-auth.server.ts'
import { adaptStoredMessageToCanonical } from '#features/chat/lib/canonical.ts'
import { EXECUTION_FENCE_HEADER, EXECUTION_STAGE_HEADER, workflowRequest, type RecoveryCheckpoint } from './recovery.ts'

const encoder = new TextEncoder()
const frame = (chunk: unknown) => encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)
const canonical = adaptStoredMessageToCanonical({ id: 'fixed-assistant', content: 'Canonical' })
const identity = () => ({ turnId: crypto.randomUUID(), attemptId: crypto.randomUUID(), token: 'a'.repeat(64) })
const wait = async (predicate: () => boolean) => { for (let i = 0; i < 1000 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 1)); expect(predicate()).toBe(true) }

function fixture() {
 const values = new Map<string, unknown>(); let alarm = 0
 const storage = {
  async get<T>(key: string) { return structuredClone(values.get(key)) as T | undefined },
  async put(entries: Record<string, unknown>) { for (const [key, value] of Object.entries(entries)) values.set(key, structuredClone(value)) },
  async list<T>({ prefix }: { prefix: string }) { return new Map([...values].filter(([key]) => key.startsWith(prefix)).sort().map(([key, value]) => [key, structuredClone(value) as T])) },
  async setAlarm(time: number) { alarm = time }, async deleteAll() { values.clear() }, async delete(keys: string[]) { keys.forEach(key => values.delete(key)) },
 }
 const tasks: Promise<unknown>[] = []; let executions = 0; let commits = 0; let cancelled = false; let holdCommit = false
 let upstream!: ReadableStreamDefaultController<Uint8Array>; let upstreamRequest!: Request; let oldRequest!: Request; let commitRequest!: Request
 let commitController!: ReadableStreamDefaultController<Uint8Array>
 const state = { storage, waitUntil: (task: Promise<unknown>) => { tasks.push(task) } }
 const id = identity(); const name = `${id.turnId}:${id.attemptId}`
 let object: ChatDelivery
 const control = async (action: string, stage?: 'generate' | 'commit') => object.fetch(await workflowRequest('test-secret', name, action, stage))
 const env: ChatDeliveryEnv = {
  CHAT_DELIVERY_SECRET: 'test-secret', CHAT_DELIVERY: { idFromName: value => value, get: () => ({ fetch: request => object.fetch(request) }) },
  CHAT_RESPONSE_WORKFLOW: { async create(input) {
   expect(input).toEqual({ id: name.replace(':', '-'), params: { name } })
   const task = (async () => {
    for (const stage of ['generate', 'commit'] as const) {
     let result: { phase: string } | null = null
     for (let retry = 0; retry < 3; retry++) {
      try { result = await (await control('run', stage)).json() as { phase: string }; break } catch { /* Model a replay of the incomplete workflow step. */ }
     }
     if (!result) { await control('workflow-fail'); return }
     if (result.phase !== 'running') return
    }
   })(); tasks.push(task); return {}
  }, async get() { return { status: async () => ({ status: 'running' }) } } },
  CHAT_EXECUTION: { async fetch(request) {
   expect(await verifyChatExecution(request.headers, 'test-secret')).toBe(true)
   const stage = request.headers.get(EXECUTION_STAGE_HEADER)
   if (stage === 'fail') return new Response(null, { status: 204 })
   if (stage === 'commit') {
    commits++; commitRequest = request
    if (holdCommit) return new Response(new ReadableStream({ start(controller) { commitController = controller } }))
    expect((await object.fetch(new Request('https://test/commit', { method: 'POST', headers: request.headers }))).status).toBe(204)
    const checkpoint = values.get('checkpoint') as RecoveryCheckpoint
    return new Response(new ReadableStream({ start(controller) {
     controller.enqueue(frame({ type: 'start', messageId: 'fixed-assistant' })); controller.enqueue(frame({ type: 'data-response', data: checkpoint.canonical })); controller.enqueue(frame({ type: 'finish', finishReason: 'stop' })); controller.close()
    } }))
   }
   executions++; oldRequest = upstreamRequest; upstreamRequest = request
   return new Response(new ReadableStream({ start(controller) { upstream = controller }, cancel() { cancelled = true } }))
  } },
 }
 object = new ChatDelivery(state, env)
 const request = (action: string, options: { owner?: string; token?: string; body?: string; after?: number; headers?: Headers } = {}) => new Request(`https://test/${action}${options.after !== undefined ? `?after=${options.after}` : ''}`, {
  method: action === 'stream' ? 'GET' : 'POST', headers: options.headers ?? { ...deliveryHeaders({ ...id, token: options.token ?? id.token }), [DELIVERY_OWNER_HEADER]: options.owner ?? 'guest', [DELIVERY_TURN_HEADER]: id.turnId, [EXECUTION_FENCE_HEADER]: upstreamRequest?.headers.get(EXECUTION_FENCE_HEADER) ?? '0' },
  ...(['start', 'checkpoint'].includes(action) ? { body: options.body ?? '{"message":"test"}' } : {}),
 })
 const start = async () => { const response = await object.fetch(request('start')); await wait(() => executions === 1); return response }
 const emit = (chunk: unknown) => upstream.enqueue(frame(chunk))
 const checkpoint = () => object.fetch(request('checkpoint', { body: JSON.stringify({ canonical, executionTrace: [] }) }))
 const finish = async () => { expect((await checkpoint()).status).toBe(204); upstream.close(); await Promise.all(tasks) }
 const reload = () => { object = new ChatDelivery(state, env) };
 const restart = () => { const previous = object; object = new ChatDelivery(state, env); upstream.error(new Error('Runtime reset')); return previous }
 return { values, request, start, emit, finish, checkpoint, restart, reload, control, tasks, state, env,
  get object() { return object }, get executions() { return executions }, get commits() { return commits }, get cancelled() { return cancelled }, get upstreamRequest() { return upstreamRequest }, get oldRequest() { return oldRequest }, get alarm() { return alarm },
  closeGeneration: () => upstream.close(), restartCommit: () => { object = new ChatDelivery(state, env); commitController.error(new Error('Runtime reset during commit')) }, holdCommit: () => { holdCommit = true }, get commitRequest() { return commitRequest }, get commitController() { return commitController },
 }
}

describe('workflow-backed chat delivery', () => {
 it('reconciles a crash or uncertain admission using the original workflow ID', async () => {
  const f=fixture();const create=f.env.CHAT_RESPONSE_WORKFLOW.create;let attempts=0;
  f.env.CHAT_RESPONSE_WORKFLOW.create=async input=>{if(++attempts===1)throw new Error('Admission response lost');return create(input)};
  f.env.CHAT_RESPONSE_WORKFLOW.get=async()=>{throw new Error('Not created yet')};
  const response=await f.object.fetch(f.request('start'));await response.body!.cancel();await Promise.all(f.tasks);expect(f.executions).toBe(0);
  f.reload();await f.object.alarm();await wait(()=>f.executions===1);await f.finish();
  expect(attempts).toBe(2);expect((f.values.get('metadata') as {phase:string}).phase).toBe('completed');
 });
 it('persists previews before delivery, deduplicates POST and reconnects without another generation', async () => {
  const f = fixture(); const response = await f.start(); await response.body!.cancel()
  f.emit({ type: 'start', messageId: 'fixed-assistant' }); f.emit({ type: 'data-progress', transient: true, data: canonical }); await wait(() => f.values.has('event:00000001'))
  const duplicate = await f.object.fetch(f.request('start')); await duplicate.body!.cancel(); expect(f.executions).toBe(1)
  expect((await f.object.fetch(f.request('start', { body: 'changed' }))).status).toBe(409)
  expect((await f.object.fetch(f.request('stream', { owner: 'another-user' }))).status).toBe(403)
  expect((await f.object.fetch(f.request('stream', { token: 'b'.repeat(64) }))).status).toBe(403)
  expect(JSON.stringify([...f.values.values()])).not.toContain('test-secret'); expect(JSON.stringify([...f.values.values()])).not.toContain('a'.repeat(64))
  await f.finish(); const replay = await (await f.object.fetch(f.request('stream', { after: 1 }))).text()
  expect(replay).not.toContain('data-progress'); expect(replay).toContain('Canonical'); expect((replay.match(/"type":"data-response"/g) ?? []).length).toBe(1)
  expect(f.executions).toBe(1); expect(f.commits).toBe(1); expect(f.values.has('request')).toBe(false); expect(f.values.has('checkpoint')).toBe(false)
 })
 it('recovers an interrupted generation under the same attempt and rejects stale execution writes', async () => {
  const f = fixture(); const response = await f.start(); await response.body!.cancel(); const old = f.upstreamRequest
  f.emit({ type: 'start', messageId: 'fixed-assistant' }); await wait(() => f.values.has('event:00000000'))
  f.restart(); const attached = await f.object.fetch(f.request('stream')); await attached.body!.cancel()
  await wait(() => f.executions === 2)
  expect((await f.object.fetch(f.request('checkpoint', { headers: old.headers, body: JSON.stringify({ canonical, executionTrace: [] }) }))).status).toBe(409)
  expect((await f.object.fetch(f.request('commit', { headers: old.headers }))).status).toBe(409)
  await f.finish(); const result = await (await f.object.fetch(f.request('stream'))).text()
  expect(result).not.toContain('interrupted'); expect((result.match(/"type":"data-response"/g) ?? []).length).toBe(1)
  expect((f.values.get('metadata') as { fence: number }).fence).toBe(3)
 })
 it('reuses the checkpoint after a commit-stage restart and publishes the final batch atomically', async () => {
  const f = fixture(); f.holdCommit(); const response = await f.start(); await response.body!.cancel()
  expect((await f.checkpoint()).status).toBe(204)
  const stageOne = f.upstreamRequest; f.closeGeneration(); await wait(() => f.commits === 1);
  const headers = f.commitRequest.headers
  expect((await f.object.fetch(f.request('commit', { headers }))).status).toBe(204)
  f.commitController.enqueue(frame({ type: 'text-start', id: 'final' })); f.commitController.enqueue(frame({ type: 'text-delta', id: 'final', delta: 'Unpublished partial final' }))
  await new Promise(resolve => setTimeout(resolve, 5)); expect(JSON.stringify([...f.values.values()])).not.toContain('Unpublished partial final')
  // A failed commit stream is retried; the model stage remains checkpointed.
  f.restartCommit(); await wait(() => f.commits === 2)
  expect((await f.object.fetch(f.request('commit', { headers: f.commitRequest.headers }))).status).toBe(204)
  f.commitController.enqueue(frame({ type: 'data-response', data: canonical })); f.commitController.enqueue(frame({ type: 'finish', finishReason: 'stop' })); f.commitController.close()
  await Promise.all(f.tasks)
  expect(f.executions).toBe(1); expect(stageOne.headers.get(EXECUTION_STAGE_HEADER)).toBe('generate')
  const replay = await (await f.object.fetch(f.request('stream'))).text(); expect(replay).not.toContain('Unpublished partial final'); expect((replay.match(/"type":"data-response"/g) ?? []).length).toBe(1)
 })
 it('Stop wins before the commit gate, survives a restart and prevents any recovery from publishing', async () => {
  const f = fixture(); const response = await f.start(); expect((await f.object.fetch(f.request('stop'))).status).toBe(204); await Promise.all(f.tasks)
  expect(f.cancelled).toBe(true); expect(f.upstreamRequest.signal.aborted).toBe(true)
  expect((await f.control('run', 'generate')).status).toBe(200); expect(f.executions).toBe(1)
  expect(await response.text()).not.toContain('data-response'); expect(f.values.has('request')).toBe(false)
  const early = fixture(); expect((await early.object.fetch(early.request('stop'))).status).toBe(204); expect((await early.object.fetch(early.request('start'))).status).toBe(409); expect(early.executions).toBe(0)
 })
 it('bounds runtime and expiry, refuses unsigned workflow control and retains only the deduplication tombstone', async () => {
  const f = fixture(); const response = await f.start(); await response.body!.cancel()
  expect((await f.object.fetch(new Request('https://test/run', { method: 'POST' }))).status).toBe(403)
  const metadata = f.values.get('metadata') as Record<string, unknown>
  await f.state.storage.put({ metadata: { ...metadata, deadline: Date.now() - 1 } }); expect((await (await f.control('run', 'generate')).json()).phase).toBe('failed')
  const expiresAt = Date.now() - 1; await f.state.storage.put({ metadata: { ...f.values.get('metadata') as Record<string, unknown>, expiresAt } }); await f.object.alarm()
  expect([...f.values.keys()]).toEqual(['metadata']); expect(f.values.get('metadata')).toEqual({ phase: 'expired', expiresAt }); expect((await f.object.fetch(f.request('start'))).status).toBe(410)
 })
})
