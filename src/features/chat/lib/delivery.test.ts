import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createDeliveryFetch, createClientDelivery, saveClientDelivery, loadClientDelivery, clearClientDelivery } from './delivery.ts'
import { ChatEventDecoder, deliveryHeaders, DELIVERY_OWNER_HEADER, DELIVERY_TURN_HEADER } from './delivery-protocol.ts'
import { signChatExecution, verifyChatExecution } from '#features/chat/api/delivery-auth.server.ts'
import { createTurnLifecycle, type ClientTurn } from './turn-lifecycle.ts'
import { adaptStoredMessageToCanonical } from './canonical.ts'
import { bootstrapGuestTurn, claimGuestTurn, getGuestConversationWithMessages } from '#shared/lib/db/guest-conversations.ts'
import { DefaultChatTransport, type UIMessageChunk } from 'ai'
import { applyProgressText, progressText } from './progress.ts'

const identity = { turnId: crypto.randomUUID(), attemptId: crypto.randomUUID(), token: 'a'.repeat(64) }
const canonical = adaptStoredMessageToCanonical({ id: 'reply', content: 'Final validated reply' })
const encoder = new TextEncoder()
function response(events: Array<{ id: number; chunk: UIMessageChunk }>, truncate = '') {
	return new Response(events.map(({ id, chunk }) => `id: ${id}\ndata: ${JSON.stringify(chunk)}\n\n`).join('') + truncate,
		{ headers: { 'x-chat-reconnectable': '1', 'x-vercel-ai-ui-message-stream': 'v1', 'content-type': 'text/event-stream' } })
}

describe('reconnectable delivery transport', () => {
	it('isolates browser capabilities by account and prevents a late cleanup deleting a newer attempt', () => {
		const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
		const cache = new Map<string, string>()
		Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
			getItem: (key: string) => cache.get(key) ?? null, setItem: (key: string, value: string) => cache.set(key, value), removeItem: (key: string) => cache.delete(key),
		} })
		try {
			const turn: ClientTurn = { conversationId: crypto.randomUUID(), startingConversationId: null, turnId: crypto.randomUUID(),
				claimId: crypto.randomUUID(), userClientMessageId: crypto.randomUUID(), assistantClientMessageId: crypto.randomUUID(), userId: 'owner', locale: 'en', content: 'Events' }
			const first = createClientDelivery(turn); saveClientDelivery(first)
			expect(loadClientDelivery(turn.conversationId, 'other')).toBeNull()
			expect(loadClientDelivery(turn.conversationId, null)).toBeNull()
			const newer = createClientDelivery({ ...turn, claimId: crypto.randomUUID() }); saveClientDelivery(newer); clearClientDelivery(first)
			expect(loadClientDelivery(turn.conversationId, 'owner')?.identity).toEqual(newer.identity)
			saveClientDelivery({ ...newer, expiresAt: Date.now() - 1 }); expect(loadClientDelivery(turn.conversationId, 'owner')).toBeNull()
		} finally {
			if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor)
			else Reflect.deleteProperty(globalThis, 'sessionStorage')
		}
	})
	it('recovers a split event below the real SDK parser, keeps the claim and stores exactly one canonical assistant', async () => {
		const turn: ClientTurn = { conversationId: crypto.randomUUID(), startingConversationId: null, turnId: identity.turnId,
			claimId: identity.attemptId, userClientMessageId: crypto.randomUUID(), assistantClientMessageId: crypto.randomUUID(),
			userId: null, locale: 'en', content: 'Events' }
		await bootstrapGuestTurn(turn); await claimGuestTurn(turn.turnId, turn.claimId)
		const events: UIMessageChunk[] = [
			{ type: 'start', messageId: turn.assistantClientMessageId },
			{ type: 'data-progress', transient: true, data: { ...canonical, text: 'Preview only' } },
			{ type: 'data-response', data: canonical }, { type: 'finish', finishReason: 'stop' },
		]
		const calls: string[] = []; const outcomes: string[] = []
		const fetchFn: typeof fetch = async (input, init) => {
			calls.push(String(input)); expect(new Headers(init?.headers).get('x-chat-token')).toBe(identity.token)
			if (calls.length === 1) return response(events.slice(0, 2).map((chunk, id) => ({ chunk, id })), 'id: 2\ndata: {"type":"data-res')
			expect(String(input)).toContain('after=1')
			// A duplicate durable prefix is harmless; the continuation is delivered once.
			return response(events.slice(1).map((chunk, index) => ({ chunk, id: index + 1 })))
		}
		const lifecycle = createTurnLifecycle(turn, { isCurrent: () => true, onPhase: () => {}, onFailure: () => outcomes.push('failed'),
			onComplete: () => { outcomes.push('completed') }, onProgress: (preview) => { if (preview) outcomes.push(preview.text) } })
		const module = (process.versions as { bun?: string }).bun
			? await import('../../../../node_modules/@ai-sdk/svelte/dist/index.js') : await import('@ai-sdk/svelte')
		const chat = new module.Chat({ ...lifecycle.callbacks, transport: new DefaultChatTransport({ fetch: createDeliveryFetch(identity, fetchFn) }) })
		await chat.sendMessage({ text: turn.content }); await lifecycle.settled()
		expect(calls.length).toBe(2); expect(outcomes).toEqual(['Preview only', 'completed'])
		const stored = await getGuestConversationWithMessages(turn.conversationId)
		expect(stored?.turns?.[0].status).toBe('completed')
		expect(stored?.messages.filter((message) => message.role === 'assistant').length).toBe(1)
		expect(JSON.stringify(stored)).not.toContain('Preview only')
	})
	it('retries a lost initial response using the same body and capability', async () => {
		let calls = 0
		const fetchFn: typeof fetch = async (_input, init) => {
			calls++; expect(init?.body).toBe('exact body'); expect(new Headers(init?.headers).get('x-chat-attempt')).toBe(identity.attemptId)
			if (calls === 1) throw new TypeError('Network unavailable')
			return response([{ id: 0, chunk: { type: 'start', messageId: 'reply' } }, { id: 1, chunk: { type: 'finish', finishReason: 'error' } }])
		}
		await (await createDeliveryFetch(identity, fetchFn)('/api/chat', { method: 'POST', body: 'exact body' })).text()
		expect(calls).toBe(2)
	})
	it('consumer cancellation never reconnects or stops the producer', async () => {
		let calls = 0; let disconnected = false
		const fetchFn: typeof fetch = async () => { calls++; return new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(': connected\n\n')) }, cancel() { disconnected = true } }), { headers: { 'x-chat-reconnectable': '1' } }) }
		const delivered = await createDeliveryFetch(identity, fetchFn)('/api/chat')
		await delivered.body!.cancel(); await new Promise((resolve) => setTimeout(resolve, 5))
		expect(calls).toBe(1); expect(disconnected).toBe(true)
	})
	it('cancelling while reconnect backoff is pending cannot attach another subscriber', async () => {
		let calls = 0
		const fetchFn: typeof fetch = async () => { calls++; return response([{ id: 0, chunk: { type: 'start', messageId: 'reply' } }]) }
		const delivered = await createDeliveryFetch(identity, fetchFn)('/api/chat')
		const reader = delivered.body!.getReader(); await reader.read()
		await new Promise((resolve) => setTimeout(resolve, 5)); await reader.cancel()
		await new Promise((resolve) => setTimeout(resolve, 550))
		expect(calls).toBe(1)
	})
	it('frames arbitrary byte boundaries and bounds unterminated events', () => {
		const decoder = new ChatEventDecoder()
		expect(decoder.push('id: 0\r')).toEqual([])
		expect(decoder.push('\ndata: {}\r\n\r')).toEqual([])
		expect(decoder.push('\n')).toEqual(['id: 0\ndata: {}'])
		expect(() => decoder.push('x'.repeat(300_000))).toThrow()
	})
	it('text updates cannot alter artifact identities, order, or membership', () => {
		const original = { ...canonical, events: [{ id: 'server-event', name: 'Verified' }] } as typeof canonical
		const next = applyProgressText(original, { ...progressText(original), text: 'New text', events: [{ id: 'forged' }] })
		expect(next?.events[0].id).toBe('server-event')
		expect(applyProgressText(original, { ...progressText(original), reasons: [] })).toBeNull()
		expect(applyProgressText(original, { ...progressText(original), requestId: 'other-attempt' })).toBeNull()
	})
	it('private execution signatures bind identity and expire', async () => {
		const headers = new Headers({ ...deliveryHeaders(identity), [DELIVERY_TURN_HEADER]: identity.turnId, [DELIVERY_OWNER_HEADER]: 'guest' })
		await signChatExecution(headers, 'secret'); expect(await verifyChatExecution(headers, 'secret')).toBe(true)
		headers.set(DELIVERY_OWNER_HEADER, 'another'); expect(await verifyChatExecution(headers, 'secret')).toBe(false)
		headers.set(DELIVERY_OWNER_HEADER, 'guest'); headers.set('x-chat-execution-time', String(Date.now() - 120_001))
		expect(await verifyChatExecution(headers, 'secret')).toBe(false)
		expect(await verifyChatExecution(headers, undefined)).toBe(false)
	})
})
