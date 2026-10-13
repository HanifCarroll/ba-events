import { Schema } from 'effect'
import {
	ChatEventDecoder, DELIVERY_OWNER_HEADER, DELIVERY_TURN_HEADER, DELIVERY_RETENTION_MS,
	DELIVERY_RUN_TIMEOUT_MS, eventData, parseDeliveryIdentity,
} from '#features/chat/lib/delivery-protocol.ts'
import { signChatExecution } from '#features/chat/api/delivery-auth.server.ts'
import { EXECUTION_FENCE_HEADER, EXECUTION_STAGE_HEADER, canonicalKey, openEnvelope, parseCheckpoint, sealEnvelope, verifyWorkflowRequest, type ExecutionStage, type RecoveryCheckpoint, type SealedEnvelope } from './recovery.ts'

type Storage = {
	get<T>(key: string): Promise<T | undefined>
	put(entries: Record<string, unknown>): Promise<void>
	list<T>(options: { prefix: string }): Promise<Map<string, T>>
	setAlarm(time: number): Promise<void>
	deleteAll(): Promise<void>
	delete(keys: string[]): Promise<unknown>
}
type State = { storage: Storage; waitUntil(promise: Promise<unknown>): void; abort?(reason: string): never }
export type ChatDeliveryEnv = {
	CHAT_EXECUTION: { fetch(request: Request): Promise<Response> }
	CHAT_DELIVERY_SECRET: string
	CHAT_DELIVERY: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } }
	CHAT_RESPONSE_WORKFLOW: { create(input: { id: string; params: { name: string } }): Promise<unknown>; get(id: string): Promise<{ status(): Promise<unknown> }> }
}
type Metadata = {
	owner: string; tokenHash: string; payloadHash: string; turnId: string; attemptId: string
	phase: 'running' | 'persisting' | 'completed' | 'failed' | 'cancelled'
	sequence: number; bytes: number; createdAt: number; expiresAt: number
	hasCanonical: boolean
	workflowId?: string; workflowAdmitted?: boolean; fence?: number; deadline?: number; hasCheckpoint?: boolean
}
type StoredMetadata = Metadata | { phase: 'expired'; expiresAt: number }
type StoredEvent = { sequence: number; data: string }

const encoder = new TextEncoder()
const MAX_LOG_BYTES = 2 * 1024 * 1024
const MAX_SUBSCRIBERS = 4
const chunkSchema = Schema.Struct({ type: Schema.String, finishReason: Schema.optional(Schema.String) })
const terminal = (metadata: Metadata) => ['completed', 'failed', 'cancelled'].includes(metadata.phase)
const encode = (event: StoredEvent) => encoder.encode(`id: ${event.sequence}\ndata: ${event.data}\n\n`)
async function digest(value: string): Promise<string> {
	return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))),
		(byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** One bounded producer per attempt, independently of its browser subscribers. */
export class ChatDelivery {
	private queue: Promise<unknown> = Promise.resolve()
	private producer: AbortController | null = null
	private admission: Promise<void> | null = null
	private subscribers = new Set<ReadableStreamDefaultController<Uint8Array>>()
	constructor(private readonly state: State, private readonly env: ChatDeliveryEnv) {}

	private serialize<T>(run: () => Promise<T>): Promise<T> {
		const task = this.queue.then(run)
		this.queue = task.catch(() => {})
		return task
	}

	private async authorize(request: Request, metadata: Metadata): Promise<boolean> {
		const identity = parseDeliveryIdentity(request.headers.get(DELIVERY_TURN_HEADER), request.headers)
		return !!identity && identity.turnId === metadata.turnId && identity.attemptId === metadata.attemptId &&
			request.headers.get(DELIVERY_OWNER_HEADER) === metadata.owner &&
			await digest(identity.token) === metadata.tokenHash
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url)
		if (['run', 'workflow-fail', 'inspect', 'interrupt'].includes(url.pathname.slice(1))) {
			if (!await verifyWorkflowRequest(request, this.env.CHAT_DELIVERY_SECRET)) return new Response(null, { status: 403 })
			const metadata = await this.state.storage.get<StoredMetadata>('metadata')
			if (!metadata || metadata.phase === 'expired' || `${metadata.turnId}:${metadata.attemptId}` !== url.searchParams.get('name')) return new Response(null, { status: 410 })
			if (url.pathname === '/inspect') return Response.json({ phase: metadata.phase, fence: metadata.fence ?? 0, checkpointed: !!metadata.hasCheckpoint, sequence: metadata.sequence, deadline: metadata.deadline })
			if (url.pathname === '/interrupt') { if (terminal(metadata)) return new Response(null, { status: 409 }); this.state.abort?.('Operator chat recovery test'); throw new Error('Object reset unavailable') }
			if (url.pathname === '/workflow-fail') {
				await this.serialize(async () => { const current = await this.state.storage.get<StoredMetadata>('metadata'); if (current && current.phase !== 'expired' && !terminal(current)) { this.producer?.abort(); await this.fail(current, 'The response was interrupted. Please retry.') } })
				return Response.json({ phase: 'failed', fence: metadata.fence ?? 0 })
			}
			const stage = url.searchParams.get('stage')
			if (stage !== 'generate' && stage !== 'commit') return new Response(null, { status: 400 })
			return this.run(stage)
		}
		if (url.pathname === '/start' && request.method === 'POST') return this.start(request)
		return this.serialize(async () => {
			let metadata = await this.state.storage.get<StoredMetadata>('metadata')
			if (!metadata && url.pathname === '/stop' && request.method === 'POST') {
				const identity = parseDeliveryIdentity(request.headers.get(DELIVERY_TURN_HEADER), request.headers)
				const owner = request.headers.get(DELIVERY_OWNER_HEADER)
				if (!identity || !owner) return new Response(null, { status: 400 })
				const now = Date.now()
				metadata = { owner, tokenHash: await digest(identity.token), payloadHash: '',
					turnId: identity.turnId, attemptId: identity.attemptId, phase: 'cancelled',
					sequence: 0, bytes: 0, createdAt: now, expiresAt: now + DELIVERY_RETENTION_MS, hasCanonical: false }
				await this.state.storage.put({ metadata })
				await this.fail(metadata, 'Response stopped')
				return new Response(null, { status: 204 })
			}
			if (!metadata || metadata.phase === 'expired' || metadata.expiresAt <= Date.now()) return new Response(null, { status: 410 })
			if (!await this.authorize(request, metadata)) return new Response(null, { status: 403 })
			if (url.pathname === '/checkpoint' || url.pathname === '/commit') {
				if (metadata.workflowId && Number(request.headers.get(EXECUTION_FENCE_HEADER)) !== metadata.fence) return new Response(null, { status: 409 })
				if (terminal(metadata) || !this.producer) return new Response(null, { status: 409 })
				if (url.pathname === '/checkpoint') {
					if (request.method === 'GET') return Response.json(await this.state.storage.get('checkpoint') ?? null)
					if (request.method !== 'POST' || metadata.phase !== 'running') return new Response(null, { status: 409 })
					const body = await request.text(); if (encoder.encode(body).byteLength > 512 * 1024) return new Response(null, { status: 413 })
					const checkpoint = parseCheckpoint(JSON.parse(body)); if (!checkpoint) return new Response(null, { status: 400 })
					if (metadata.hasCheckpoint) return new Response(null, { status: 409 })
					metadata.hasCheckpoint = true
					// A short publication budget remains inside the original two-minute turn claim.
					metadata.deadline = Math.min(metadata.createdAt + DELIVERY_RUN_TIMEOUT_MS + 20_000, Date.now() + 20_000)
					await this.state.storage.put({ metadata, checkpoint })
					await this.state.storage.setAlarm(metadata.deadline)
					return new Response(null, { status: 204 })
				}
			}
			if (url.pathname === '/commit' && request.method === 'POST') {
				if (!['running', 'persisting'].includes(metadata.phase) || !this.producer || metadata.workflowId && !metadata.hasCheckpoint) return new Response(null, { status: 409 })
				metadata.phase = 'persisting'
				await this.state.storage.put({ metadata })
				return new Response(null, { status: 204 })
			}
			if (url.pathname === '/stop' && request.method === 'POST') {
				if (metadata.phase === 'persisting' || metadata.phase === 'completed') return new Response(null, { status: 409 })
				if (!terminal(metadata)) {
					metadata.phase = 'cancelled'
					await this.state.storage.put({ metadata })
					this.producer?.abort()
					await this.fail(metadata, 'Response stopped')
				}
				return new Response(null, { status: 204 })
			}
			if (url.pathname !== '/stream' || request.method !== 'GET') return new Response(null, { status: 404 })
			// Workflows recover new attempts; pre-workflow attempts retain their old fail-closed policy.
			if (!terminal(metadata) && !this.producer && !metadata.workflowId) await this.fail(metadata, 'The response was interrupted. Please retry.')
			return this.subscribe(metadata, url.searchParams.get('after'))
		})
	}

	private async start(request: Request): Promise<Response> {
		const body = await request.text()
		if (encoder.encode(body).byteLength > 128 * 1024) return new Response(null, { status: 413 })
		const identity = parseDeliveryIdentity(request.headers.get(DELIVERY_TURN_HEADER), request.headers)
		const owner = request.headers.get(DELIVERY_OWNER_HEADER)
		if (!identity || !owner || !this.env.CHAT_DELIVERY_SECRET || !this.env.CHAT_RESPONSE_WORKFLOW) return new Response(null, { status: 400 })
		const tokenHash = await digest(identity.token)
		const payloadHash = await digest(body)
		return this.serialize(async () => {
			let metadata = await this.state.storage.get<StoredMetadata>('metadata')
			if (metadata) {
				if (metadata.phase === 'expired' || metadata.expiresAt <= Date.now()) return new Response(null, { status: 410 })
				if (!await this.authorize(request, metadata) || metadata.payloadHash !== payloadHash) return new Response(null, { status: 409 })
				if (!terminal(metadata) && !this.producer && !metadata.workflowId) await this.fail(metadata, 'The response was interrupted. Please retry.')
			} else {
				const now = Date.now()
				const name = `${identity.turnId}-${identity.attemptId}`
				metadata = { owner, tokenHash, payloadHash, turnId: identity.turnId, attemptId: identity.attemptId,
					phase: 'running', sequence: 0, bytes: 0, hasCanonical: false, createdAt: now, expiresAt: now + DELIVERY_RETENTION_MS,
					workflowId: name, fence: 0, deadline: now + DELIVERY_RUN_TIMEOUT_MS, hasCheckpoint: false }
				const headers = new Headers()
				for (const key of ['cookie', 'authorization', 'x-chat-token', 'x-chat-attempt', DELIVERY_OWNER_HEADER, DELIVERY_TURN_HEADER, 'x-chat-client-ip']) { const value = request.headers.get(key); if (value) headers.set(key, value) }
				headers.set('content-type', 'application/json')
				const envelope = await sealEnvelope({ url: request.url, headers: [...headers], body }, this.env.CHAT_DELIVERY_SECRET, name)
				await this.state.storage.put({ metadata, request: envelope })
				// Reconcile admission after a crash between durable input and workflow creation.
				await this.state.storage.setAlarm(now + 1000)
				// The workflow stores only an opaque object reference; credentials stay encrypted and bounded here.
				this.state.waitUntil(this.ensureWorkflow(metadata))
			}
			return this.subscribe(metadata, null)
		})
	}

	private async ensureWorkflow(metadata: Metadata): Promise<void> {
		if (this.admission) return this.admission
		this.admission = (async () => {
			let admitted = false
			try { await this.env.CHAT_RESPONSE_WORKFLOW.create({ id: metadata.workflowId!, params: { name: `${metadata.turnId}:${metadata.attemptId}` } }); admitted = true }
			catch { try { await (await this.env.CHAT_RESPONSE_WORKFLOW.get(metadata.workflowId!)).status(); admitted = true } catch { /* The alarm retries an uncertain admission without changing its ID. */ } }
			await this.serialize(async () => {
				const current = await this.state.storage.get<StoredMetadata>('metadata')
				if (!current || current.phase === 'expired' || terminal(current)) return
				if (admitted) { current.workflowAdmitted = true; await this.state.storage.put({ metadata: current }) }
				await this.state.storage.setAlarm(admitted ? current.deadline! : Math.min(Date.now() + 1000, current.deadline!))
			})
		})()
		try { await this.admission } finally { this.admission = null }
	}

	private async run(stage: ExecutionStage): Promise<Response> {
		const task = await this.serialize(async () => {
			const metadata = await this.state.storage.get<StoredMetadata>('metadata')
			if (!metadata || metadata.phase === 'expired') return { phase: 'expired', fence: 0 }
			if (terminal(metadata)) return { phase: metadata.phase, fence: metadata.fence ?? 0 }
			if (metadata.deadline! <= Date.now()) { this.producer?.abort(); await this.fail(metadata, 'The response timed out. Please retry.'); return { phase: 'failed', fence: metadata.fence ?? 0 } }
			if (stage === 'generate' && metadata.hasCheckpoint) return { phase: metadata.phase, fence: metadata.fence ?? 0 }
			if (stage === 'commit' && !metadata.hasCheckpoint) throw new Error('Missing validated checkpoint')
			const sealed = await this.state.storage.get<SealedEnvelope>('request')
			if (!sealed) throw new Error('Missing recovery request')
			const envelope = await openEnvelope(sealed, this.env.CHAT_DELIVERY_SECRET, metadata.workflowId!)
			this.producer?.abort()
			const controller = new AbortController(); this.producer = controller
			const fence = (metadata.fence ?? 0) + 1; metadata.fence = fence
			await this.state.storage.put({ metadata })
			const headers = new Headers(envelope.headers); headers.set(EXECUTION_FENCE_HEADER, String(fence)); headers.set(EXECUTION_STAGE_HEADER, stage)
			// The promise is returned inside an object so serialization does not await the producer.
			return { work: this.produce(new Request(envelope.url, { method: 'POST', headers }), envelope.body, controller, stage, fence), fence }
		})
		if ('work' in task) await task.work
		const current = await this.state.storage.get<StoredMetadata>('metadata')
		if (current && current.phase !== 'expired' && !terminal(current) && current.fence !== task.fence) throw new Error('Superseded workflow execution')
		return Response.json({ phase: current?.phase ?? 'expired', fence: task.fence })
	}

	private async produce(request: Request, body: string, controller: AbortController, stage: ExecutionStage, fence: number): Promise<void> {
		let completed = false
		const batch: string[] = []; let batchBytes = 0
		try {
			const headers = new Headers(request.headers)
			await signChatExecution(headers, this.env.CHAT_DELIVERY_SECRET)
			const url = new URL(request.url)
			url.pathname = '/api/chat/execute'
			url.search = ''
			const response = await this.env.CHAT_EXECUTION.fetch(new Request(url, {
				method: 'POST', headers, body, signal: controller.signal,
			}))
			if (!response.ok || !response.body) throw new Error('Chat execution unavailable')
			const reader = response.body.getReader()
			const cancelReader = () => { void reader.cancel().catch(() => {}) }
			controller.signal.addEventListener('abort', cancelReader, { once: true })
			if (controller.signal.aborted) cancelReader()
			const decoder = new TextDecoder()
			const events = new ChatEventDecoder()
			try {
				while (!controller.signal.aborted) {
					const { done, value } = await reader.read()
					if (done) break
					for (const frame of events.push(decoder.decode(value, { stream: true }))) {
						const data = eventData(frame)
						if (data && data !== '[DONE]') await this.serialize(async () => {
							const metadata = await this.state.storage.get<StoredMetadata>('metadata')
							if (metadata && metadata.phase !== 'expired' && !terminal(metadata) && metadata.fence === fence) {
								if (stage === 'commit') {
									batchBytes += encoder.encode(data).byteLength; if (batchBytes > 512 * 1024) throw new Error('Final response exceeds delivery limit')
									batch.push(data)
									if (JSON.parse(data).type === 'finish') { await this.publishFinal(metadata, batch); completed = true }
								} else { await this.append(metadata, data); completed ||= terminal(metadata) }
							}
						})
					}
				}
			} finally {
				controller.signal.removeEventListener('abort', cancelReader)
				await reader.cancel().catch(() => {}); reader.releaseLock()
			}
		} finally {
			if (this.producer === controller) this.producer = null
		}
		const current = await this.state.storage.get<StoredMetadata>('metadata')
		if (current && current.phase !== 'expired' && !terminal(current) && current.fence === fence && !(stage === 'generate' && current.hasCheckpoint) && !completed) throw new Error('Recoverable chat execution interruption')
	}

	private async publishFinal(metadata: Metadata, batch: string[]): Promise<void> {
		const checkpoint = await this.state.storage.get<RecoveryCheckpoint>('checkpoint')
		const chunks = batch.map(data => JSON.parse(data) as { type: string; data?: unknown; finishReason?: string })
		const canonicals = chunks.filter(chunk => chunk.type === 'data-response')
		const last = chunks.at(-1)
		if (last?.type !== 'finish' || canonicals.length !== 1 || last.finishReason !== 'stop' || metadata.phase !== 'persisting' || !checkpoint || canonicalKey(canonicals[0].data) !== canonicalKey(checkpoint.canonical)) {
			if (canonicals.length === 0 && last?.finishReason === 'error') { await this.fail(metadata, 'The response was interrupted. Please retry.'); return }
			throw new Error('Invalid checkpoint publication')
		}
		const bytes = batch.map(data => encoder.encode(data).byteLength)
		if (bytes.some(size => size > 128 * 1024) || metadata.bytes + bytes.reduce((a, b) => a + b, 0) > MAX_LOG_BYTES) throw new Error('Chat delivery limit exceeded')
		const entries: Record<string, unknown> = {}
		const events = batch.map(data => ({ sequence: metadata.sequence++, data }))
		for (const event of events) entries[`event:${String(event.sequence).padStart(8, '0')}`] = event
		metadata.bytes += bytes.reduce((a, b) => a + b, 0); metadata.hasCanonical = true; metadata.phase = 'completed'
		// Completion is one atomic durable batch: a restart cannot leave a half-published final response.
		await this.state.storage.put({ ...entries, metadata })
		for (const event of events) for (const subscriber of this.subscribers) { try { subscriber.enqueue(encode(event)) } catch { this.subscribers.delete(subscriber) } }
		this.closeSubscribers(); await this.state.storage.delete(['request', 'checkpoint']); await this.state.storage.setAlarm(metadata.expiresAt)
	}

	private async append(metadata: Metadata, data: string): Promise<void> {
		const parsed = Schema.decodeUnknownResult(chunkSchema)(JSON.parse(data))
		if (parsed._tag !== 'Success') throw new Error('Invalid chat event')
		const chunk = parsed.success
		if (chunk.type === 'data-response' && (metadata.phase !== 'persisting' || metadata.hasCanonical)) {
			throw new Error('Canonical response requires the commit gate')
		}
		const bytes = encoder.encode(data).byteLength
		const limit = chunk.type === 'error' || chunk.type === 'finish' ? MAX_LOG_BYTES : MAX_LOG_BYTES - 2048
		if (bytes > 128 * 1024 || metadata.bytes + bytes > limit) throw new Error('Chat delivery limit exceeded')
		metadata.hasCanonical ||= chunk.type === 'data-response'
		if (chunk.type === 'finish') {
			metadata.phase = chunk.finishReason === 'stop' && metadata.hasCanonical ? 'completed' : 'failed'
		}
		const event: StoredEvent = { sequence: metadata.sequence++, data }
		metadata.bytes += bytes
		// Persist before publishing. A reconnect sees exactly the ordered durable prefix.
		await this.state.storage.put({ metadata, [`event:${String(event.sequence).padStart(8, '0')}`]: event })
		for (const subscriber of this.subscribers) {
			try { subscriber.enqueue(encode(event)) } catch { this.subscribers.delete(subscriber) }
		}
		if (chunk.type === 'finish') {
			this.closeSubscribers()
			await this.state.storage.delete(['request', 'checkpoint'])
			await this.state.storage.setAlarm(metadata.expiresAt)
		}
	}

	private async fail(metadata: Metadata, errorText: string): Promise<void> {
		const phase = metadata.phase === 'cancelled' ? 'cancelled' : 'failed'
		// Best-effort guarded claim cleanup never acquires or extends ownership.
		if (metadata.workflowId) {
			try {
				const sealed = await this.state.storage.get<SealedEnvelope>('request')
				if (sealed) {
					const envelope = await openEnvelope(sealed, this.env.CHAT_DELIVERY_SECRET, metadata.workflowId)
					const url = new URL(envelope.url); url.pathname = '/api/chat/execute'; url.search = ''
					const headers = new Headers(envelope.headers); headers.set(EXECUTION_FENCE_HEADER, String(metadata.fence ?? 0)); headers.set(EXECUTION_STAGE_HEADER, 'fail')
					await signChatExecution(headers, this.env.CHAT_DELIVERY_SECRET)
					await this.env.CHAT_EXECUTION.fetch(new Request(url, { method: 'POST', headers, body: envelope.body, signal: AbortSignal.timeout(3000) }))
				}
			} catch { /* Original claim bounds remain authoritative when cleanup is unavailable. */ }
		}
		// Append through the same ordered path, including for interrupted object instances.
		if (metadata.sequence === 0) await this.append(metadata, JSON.stringify({ type: 'start', messageId: metadata.turnId }))
		await this.append(metadata, JSON.stringify({ type: 'error', errorText }))
		await this.append(metadata, JSON.stringify({ type: 'finish', finishReason: 'error' }))
		metadata.phase = phase
		await this.state.storage.put({ metadata })
	}

	private async subscribe(metadata: Metadata, afterValue: string | null): Promise<Response> {
		const after = afterValue === null ? -1 : Number(afterValue)
		if (!Number.isSafeInteger(after) || after < -1 || after >= metadata.sequence && after !== -1) return new Response(null, { status: 400 })
		if (this.subscribers.size >= MAX_SUBSCRIBERS) return new Response(null, { status: 429 })
		let subscriber: ReadableStreamDefaultController<Uint8Array>
		const stream = new ReadableStream<Uint8Array>({
			start: (controller) => { subscriber = controller },
			cancel: () => { this.subscribers.delete(subscriber) },
		})
		const entries = await this.state.storage.list<StoredEvent>({ prefix: 'event:' })
		for (const event of entries.values()) if (event.sequence > after) subscriber!.enqueue(encode(event))
		if (terminal(metadata)) {
			subscriber!.enqueue(encoder.encode('data: [DONE]\n\n'))
			subscriber!.close()
		} else {
			subscriber!.enqueue(encoder.encode(': connected\n\n'))
			this.subscribers.add(subscriber!)
		}
		return new Response(stream, { headers: {
			'content-type': 'text/event-stream', 'cache-control': 'no-store, no-transform',
			'x-vercel-ai-ui-message-stream': 'v1', 'x-chat-reconnectable': '1',
		} })
	}

	private closeSubscribers(): void {
		for (const subscriber of this.subscribers) {
			try { subscriber.enqueue(encoder.encode('data: [DONE]\n\n')); subscriber.close() } catch { /* Already disconnected. */ }
		}
		this.subscribers.clear()
	}

	async alarm(): Promise<void> {
		await this.serialize(async () => {
			const metadata = await this.state.storage.get<StoredMetadata>('metadata')
			if (!metadata || metadata.phase === 'expired') return
			if (metadata.expiresAt <= Date.now()) {
				this.producer?.abort(); this.closeSubscribers(); await this.state.storage.deleteAll()
				// Keep only an expiry marker: no user identity, hashes or response content.
				await this.state.storage.put({ metadata: { phase: 'expired', expiresAt: metadata.expiresAt } })
				return
			}
			if (!terminal(metadata)) {
				if (metadata.workflowId && !metadata.workflowAdmitted && metadata.deadline! > Date.now()) {
					this.state.waitUntil(this.ensureWorkflow(metadata))
					await this.state.storage.setAlarm(Math.min(Date.now() + 1000, metadata.deadline!)); return
				}
				if (metadata.deadline && metadata.deadline > Date.now()) { await this.state.storage.setAlarm(metadata.deadline); return }
				this.producer?.abort(); await this.fail(metadata, 'The response timed out. Please retry.')
			}
			await this.state.storage.setAlarm(metadata.expiresAt)
		})
	}
}

// No public execution surface. The web Worker reaches the class through its binding.
export default { fetch: () => new Response(null, { status: 404 }) }
