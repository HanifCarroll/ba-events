import { DefaultChatTransport, type UIMessage } from 'ai'
import { Schema } from 'effect'
import { createActor } from 'xstate'
import { deliveryMachine } from './delivery.machine.ts'
import type { ClientTurn } from './turn-lifecycle.ts'
import {
	ChatEventDecoder, DELIVERY_RETENTION_MS, deliveryHeaders, deliveryStreamUrl,
	eventData, eventOffset, type DeliveryIdentity,
	parseDeliveryIdentity,
} from './delivery-protocol.ts'

export type ClientDelivery = { turn: ClientTurn; identity: DeliveryIdentity; expiresAt: number }
const storageKey = (conversationId: string, userId: string | null) => `ba-events:delivery:${userId ?? 'guest'}:${conversationId}`
const schema = Schema.Struct({
	turn: Schema.Struct({ conversationId: Schema.String, startingConversationId: Schema.NullOr(Schema.String),
		turnId: Schema.String, userClientMessageId: Schema.String, assistantClientMessageId: Schema.String,
		claimId: Schema.String, userId: Schema.NullOr(Schema.String), content: Schema.String, locale: Schema.Literals(['en', 'es']) }),
	identity: Schema.Struct({ turnId: Schema.String, attemptId: Schema.String, token: Schema.String }),
	expiresAt: Schema.Number,
})

export function createClientDelivery(turn: ClientTurn): ClientDelivery {
	const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('')
	return { turn, identity: { turnId: turn.turnId, attemptId: turn.claimId, token }, expiresAt: Date.now() + DELIVERY_RETENTION_MS }
}

export function saveClientDelivery(delivery: ClientDelivery): void {
	try { sessionStorage.setItem(storageKey(delivery.turn.conversationId, delivery.turn.userId), JSON.stringify(delivery)) }
	catch { /* Storage denial does not disable connection-level recovery. */ }
}

export function loadClientDelivery(conversationId: string, userId: string | null): ClientDelivery | null {
	try {
		const raw = sessionStorage.getItem(storageKey(conversationId, userId))
		if (!raw) return null
		const parsed = Schema.decodeUnknownResult(schema)(JSON.parse(raw))
		if (parsed._tag !== 'Success') return null
		const value = parsed.success
		return value.expiresAt > Date.now() && value.turn.conversationId === conversationId && value.turn.userId === userId &&
			value.identity.turnId === value.turn.turnId && value.identity.attemptId === value.turn.claimId &&
			parseDeliveryIdentity(value.identity.turnId, new Headers(deliveryHeaders(value.identity))) ? value : null
	} catch { return null }
}

export function clearClientDelivery(delivery: ClientDelivery): void {
	try {
		// A late callback may not delete a newer attempt's reconnect capability.
		const current = loadClientDelivery(delivery.turn.conversationId, delivery.turn.userId)
		if (current?.identity.attemptId === delivery.identity.attemptId) sessionStorage.removeItem(storageKey(delivery.turn.conversationId, delivery.turn.userId))
	} catch { /* Best effort browser cache cleanup. */ }
}

/** Reconnect below the SDK parser, so a network drop never becomes a terminal callback. */
export function createDeliveryFetch(identity: DeliveryIdentity, fetchFn: typeof fetch = globalThis.fetch): typeof fetch {
	return async (input, init) => {
		const actor = createActor(deliveryMachine).start()
		const state = () => actor.getSnapshot()
		const connection = new AbortController()
		const signal = init?.signal ? AbortSignal.any([init.signal, connection.signal]) : connection.signal
		let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
		const cancel = (by: 'consumer' | 'signal') => {
			actor.send({ type: 'CANCEL', by }); connection.abort()
			void reader?.cancel().catch(() => {})
		}
		const abort = () => cancel('signal')
		if (init?.signal?.aborted) abort()
		else init?.signal?.addEventListener('abort', abort, { once: true })
		const cleanup = () => { init?.signal?.removeEventListener('abort', abort); actor.stop() }
		const headers = new Headers(init?.headers)
		for (const [name, value] of Object.entries(deliveryHeaders(identity))) headers.set(name, value)
		const delay = () => new Promise<void>((resolve, reject) => {
			const stop = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }
			const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve() }, Math.min(250 * 2 ** state().context.failures, 2000))
			if (signal.aborted) stop()
			else signal.addEventListener('abort', stop, { once: true })
		})
		let response: Response
		try {
			// A lost POST response retains the same body, identity and server deduplication key.
			while (true) {
				signal.throwIfAborted()
				try { response = await fetchFn(input, { ...init, headers, signal }); break }
				catch (error) {
					if (signal.aborted) throw error
					actor.send({ type: 'LOST' })
					if (state().matches('failed')) throw error
					await delay(); actor.send({ type: 'RETRY' })
				}
			}
			if (!response.ok || !response.body || response.headers.get('x-chat-reconnectable') !== '1') {
				actor.send({ type: 'PASSTHROUGH' }); cleanup(); return response
			}
		} catch (error) { cleanup(); throw error }
		actor.send({ type: 'CONNECTED' })
		let source = response.body!
		const encoder = new TextEncoder()
		const body = new ReadableStream<Uint8Array>({
			async start(controller) {
				try {
					while (state().matches('streaming')) {
						const frames = new ChatEventDecoder()
						const decoder = new TextDecoder()
						reader = source.getReader()
						try {
							while (state().matches('streaming')) {
								const { done, value } = await reader.read()
								if (done || state().matches('cancelled')) break
								for (const frame of frames.push(decoder.decode(value, { stream: true }))) {
									const data = eventData(frame)
									if (!data || data === '[DONE]') continue
									const next = eventOffset(frame)
									if (next === null) throw new Error('Missing chat delivery offset')
									if (next <= state().context.offset) continue
									if (next !== state().context.offset + 1) throw new Error('Missing chat delivery event')
									const finished = (JSON.parse(data) as { type?: unknown }).type === 'finish'
									actor.send({ type: 'FRAME', offset: next, finished })
									controller.enqueue(encoder.encode(`data: ${data}\n\n`))
									if (finished) break
								}
							}
						} catch (error) { if (signal.aborted) throw error }
						finally { await reader.cancel().catch(() => {}); reader.releaseLock(); reader = null }
						if (state().matches('completed')) break
						signal.throwIfAborted()
						actor.send({ type: 'LOST' })
						while (state().matches('reconnect_wait')) {
							await delay()
							if (state().matches('cancelled')) signal.throwIfAborted()
							actor.send({ type: 'RETRY' })
							try {
								const next = await fetchFn(deliveryStreamUrl(identity, state().context.offset), { headers, signal, credentials: 'same-origin' })
								if (state().matches('cancelled')) { await next.body?.cancel(); signal.throwIfAborted() }
								if (!next.ok || !next.body) throw new Error('Chat delivery unavailable')
								source = next.body
								actor.send({ type: 'CONNECTED' })
							} catch (error) {
								if (signal.aborted) throw error
								actor.send({ type: 'LOST' })
							}
						}
						if (state().matches('failed')) throw new Error('Chat delivery interrupted')
					}
					if (state().matches('cancelled')) signal.throwIfAborted()
					controller.enqueue(encoder.encode('data: [DONE]\n\n'))
					controller.close()
				} catch (error) { if (state().context.cancelledBy !== 'consumer') controller.error(error) }
				finally { cleanup() }
			},
			cancel: () => { cancel('consumer'); return reader?.cancel() },
		})
		return new Response(body, { status: response.status, headers: response.headers })
	}
}

export function deliveryTransport<Message extends UIMessage>(delivery: ClientDelivery): DefaultChatTransport<Message> {
	return new DefaultChatTransport<Message>({
		api: '/api/chat', headers: deliveryHeaders(delivery.identity), fetch: createDeliveryFetch(delivery.identity),
		prepareReconnectToStreamRequest: () => ({ api: deliveryStreamUrl(delivery.identity) }),
	})
}

export async function stopClientDelivery(delivery: ClientDelivery): Promise<boolean> {
	const response = await fetch(`/api/chat/${delivery.identity.turnId}/stop`, {
		method: 'POST', headers: deliveryHeaders(delivery.identity),
	})
	if (response.status === 409) return false
	if (!response.ok && response.status !== 410) throw new Error('Failed to stop response')
	return true
}
