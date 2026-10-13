import { describe, expect, it } from 'vitest'
import { ChatDelivery } from './index.ts'
import { deliveryHeaders, DELIVERY_OWNER_HEADER, DELIVERY_TURN_HEADER } from '#features/chat/lib/delivery-protocol.ts'
import { verifyChatExecution } from '#features/chat/api/delivery-auth.server.ts'

const encoder = new TextEncoder()
const frame = (chunk: unknown) => encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)
const identity = () => ({ turnId: crypto.randomUUID(), attemptId: crypto.randomUUID(), token: 'a'.repeat(64) })

function fixture() {
	const values = new Map<string, unknown>()
	let alarm = 0
	const storage = {
		async get<T>(key: string) { return structuredClone(values.get(key)) as T | undefined },
		async put(entries: Record<string, unknown>) { for (const [key, value] of Object.entries(entries)) values.set(key, structuredClone(value)) },
		async list<T>({ prefix }: { prefix: string }) { return new Map([...values].filter(([key]) => key.startsWith(prefix)).sort().map(([key, value]) => [key, structuredClone(value) as T])) },
		async setAlarm(time: number) { alarm = time },
		async deleteAll() { values.clear() },
	}
	const tasks: Promise<unknown>[] = []
	let upstream!: ReadableStreamDefaultController<Uint8Array>
	let upstreamRequest!: Request
	let executions = 0
	let cancelled = false
	let ready!: () => void
	const started = new Promise<void>((resolve) => { ready = resolve })
	const state = { storage, waitUntil: (task: Promise<unknown>) => { tasks.push(task) } }
	const env = { CHAT_DELIVERY_SECRET: 'test-secret', CHAT_EXECUTION: { async fetch(request: Request) {
		executions++; upstreamRequest = request
		expect(await verifyChatExecution(request.headers, 'test-secret')).toBe(true)
		return new Response(new ReadableStream<Uint8Array>({ start(controller) { upstream = controller; ready() }, cancel() { cancelled = true } }))
	} } }
	const object = new ChatDelivery(state, env)
	const id = identity()
	const request = (action: string, options: { owner?: string; token?: string; body?: string; after?: number } = {}) => new Request(`https://test/${action}${options.after !== undefined ? `?after=${options.after}` : ''}`, {
		method: action === 'stream' ? 'GET' : 'POST',
		headers: { ...deliveryHeaders({ ...id, token: options.token ?? id.token }), [DELIVERY_OWNER_HEADER]: options.owner ?? 'guest', [DELIVERY_TURN_HEADER]: id.turnId },
		...(action === 'start' ? { body: options.body ?? '{"message":"test"}' } : {}),
	})
	const waitEvents = async (count: number) => {
		for (let index = 0; index < 100 && [...values.keys()].filter((key) => key.startsWith('event:')).length < count; index++) await new Promise((resolve) => setTimeout(resolve, 1))
		expect([...values.keys()].filter((key) => key.startsWith('event:')).length).toBeGreaterThanOrEqual(count)
	}
	const emit = (chunk: unknown) => upstream.enqueue(frame(chunk))
	const finish = async () => {
		expect((await object.fetch(request('commit'))).status).toBe(204)
		emit({ type: 'data-response', data: { text: 'Canonical' } })
		emit({ type: 'finish', finishReason: 'stop' }); upstream.close()
		await Promise.all(tasks)
	}
	return { object, state, env, values, request, started, emit, finish, waitEvents, tasks,
		get executions() { return executions }, get cancelled() { return cancelled }, get upstreamRequest() { return upstreamRequest }, get alarm() { return alarm } }
}

describe('durable chat delivery', () => {
	it('keeps the producer alive after disconnect and replays only the missing durable prefix', async () => {
		const f = fixture(); const response = await f.object.fetch(f.request('start')); await f.started
		const reader = response.body!.getReader(); await reader.read()
		f.emit({ type: 'start', messageId: 'fixed-assistant' }); f.emit({ type: 'data-progress', transient: true, data: { text: 'Preview' } })
		await f.waitEvents(2); await reader.cancel()
		expect(f.upstreamRequest.signal.aborted).toBe(false)
		await f.finish()
		const replay = await f.object.fetch(f.request('stream', { after: 1 }))
		const text = await replay.text()
		expect(text).not.toContain('Preview'); expect(text).toContain('id: 2'); expect(text).toContain('Canonical')
		expect(f.executions).toBe(1)
		expect(JSON.stringify([...f.values.values()])).not.toContain('test-secret')
		expect(JSON.stringify([...f.values.values()])).not.toContain('a'.repeat(64))
	})
	it('deduplicates a lost POST and refuses body, account, or capability changes', async () => {
		const f = fixture(); const first = await f.object.fetch(f.request('start')); await f.started; await first.body!.cancel()
		const duplicate = await f.object.fetch(f.request('start')); await duplicate.body!.cancel()
		expect(f.executions).toBe(1)
		expect((await f.object.fetch(f.request('start', { body: 'different' }))).status).toBe(409)
		expect((await f.object.fetch(f.request('stream', { owner: 'other-account' }))).status).toBe(403)
		expect((await f.object.fetch(f.request('stream', { token: 'b'.repeat(64) }))).status).toBe(403)
		await f.finish()
	})
	it('records an early Stop so a delayed POST can never start generation', async () => {
		const f = fixture()
		expect((await f.object.fetch(f.request('stop'))).status).toBe(204)
		expect((await f.object.fetch(f.request('start'))).status).toBe(409)
		expect(f.executions).toBe(0)
		const replay = await (await f.object.fetch(f.request('stream'))).text()
		expect(replay.indexOf('"type":"start"')).toBeLessThan(replay.indexOf('"type":"error"'))
		expect(replay).not.toContain('data-response')
	})
	it('Stop aborts execution and blocks canonical publication; the commit gate wins an opposite race', async () => {
		const stopped = fixture(); const response = await stopped.object.fetch(stopped.request('start')); await stopped.started
		expect((await stopped.object.fetch(stopped.request('stop'))).status).toBe(204)
		await Promise.all(stopped.tasks)
		expect(stopped.upstreamRequest.signal.aborted).toBe(true); expect(stopped.cancelled).toBe(true)
		expect((await stopped.object.fetch(stopped.request('commit'))).status).toBe(409)
		expect(await response.text()).not.toContain('data-response')
		const committed = fixture(); const running = await committed.object.fetch(committed.request('start')); await committed.started
		expect((await committed.object.fetch(committed.request('commit'))).status).toBe(204)
		expect((await committed.object.fetch(committed.request('stop'))).status).toBe(409)
		committed.emit({ type: 'data-response', data: {} }); committed.emit({ type: 'finish', finishReason: 'stop' })
		await committed.waitEvents(2); expect(await running.text()).toContain('data-response')
		// Finish closes delivery before any post-response debug work upstream.
		expect(committed.upstreamRequest.signal.aborted).toBe(false)
	})
	it('fails closed after object restart without rerunning the provider, and expires to a deduplication tombstone', async () => {
		const f = fixture(); const response = await f.object.fetch(f.request('start')); await f.started
		f.emit({ type: 'start', messageId: 'fixed' }); await f.waitEvents(1); await response.body!.cancel()
		const restarted = new ChatDelivery(f.state, f.env)
		const replay = await (await restarted.fetch(f.request('stream'))).text()
		expect(replay).toContain('interrupted'); expect(replay).not.toContain('data-response'); expect(f.executions).toBe(1)
		const metadata = await f.state.storage.get<Record<string, unknown>>('metadata')
		const expiresAt = Date.now() - 1
		await f.state.storage.put({ metadata: { ...metadata, expiresAt } }); await restarted.alarm()
		expect([...f.values.keys()]).toEqual(['metadata'])
		expect(f.values.get('metadata')).toEqual({ phase: 'expired', expiresAt })
		expect((await restarted.fetch(f.request('start'))).status).toBe(410)
		expect(f.executions).toBe(1)
		await f.object.fetch(f.request('stop'))
	})
	it('rejects canonical data before the persistence gate and treats truncated upstream data as failure', async () => {
		const f = fixture(); const response = await f.object.fetch(f.request('start')); await f.started
		f.emit({ type: 'data-response', data: { text: 'Premature' } })
		await Promise.all(f.tasks)
		const text = await response.text(); expect(text).not.toContain('Premature'); expect(text).toContain('"finishReason":"error"')
	})
})
