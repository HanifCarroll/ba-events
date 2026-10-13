import { DefaultChatTransport, type UIMessage } from 'ai'
import { Schema } from 'effect'
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
		const signal = init?.signal
		const headers = new Headers(init?.headers)
		for (const [name, value] of Object.entries(deliveryHeaders(identity))) headers.set(name, value)
		let response: Response
		let failures = 0
		const delay = () => new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, Math.min(250 * 2 ** failures, 2000))
			const abort = () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')) }
			if (signal?.aborted) abort()
			else signal?.addEventListener('abort', abort, { once: true })
		})
		// A lost POST response is retried with the same identity and exact body; the object deduplicates it.
		while (true) {
			try { response = await fetchFn(input, { ...init, headers }); break }
			catch (error) { if (signal?.aborted || ++failures > 5) throw error; await delay() }
		}
		if (!response.ok || !response.body || response.headers.get('x-chat-reconnectable') !== '1') return response
		let source = response.body
		let offset = -1
		let finished = false
		let cancelled = false
		const encoder = new TextEncoder()
		let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
		const body = new ReadableStream<Uint8Array>({
			async start(controller) {
				try {
					while (!finished && !cancelled) {
						const frames = new ChatEventDecoder()
						const decoder = new TextDecoder()
						reader = source.getReader()
						try {
							while (true) {
								const { done, value } = await reader.read()
								if (done || cancelled) break
								for (const frame of frames.push(decoder.decode(value, { stream: true }))) {
									const data = eventData(frame)
									if (!data || data === '[DONE]') continue
									const next = eventOffset(frame)
									if (next === null) throw new Error('Missing chat delivery offset')
									if (next <= offset) continue
									if (next !== offset + 1) throw new Error('Missing chat delivery event')
									offset = next
									finished = (JSON.parse(data) as { type?: unknown }).type === 'finish'
									controller.enqueue(encoder.encode(`data: ${data}\n\n`))
									failures = 0
								}
							}
						} catch (error) { if (signal?.aborted) throw error }
						finally { await reader.cancel().catch(() => {}); reader.releaseLock(); reader = null }
						if (finished) break
						if (cancelled) return
						if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
						let reconnected = false
						while (!reconnected) {
							if (++failures > 5) throw new Error('Chat delivery interrupted')
							await delay()
							if (cancelled) return
							try {
								const next = await fetchFn(deliveryStreamUrl(identity, offset), { headers, signal, credentials: 'same-origin' })
								if (cancelled) { await next.body?.cancel(); return }
								if (!next.ok || !next.body) throw new Error('Chat delivery unavailable')
								source = next.body
								reconnected = true
							} catch (error) { if (signal?.aborted) throw error }
						}
					}
					if (cancelled) return
					controller.enqueue(encoder.encode('data: [DONE]\n\n'))
					controller.close()
				} catch (error) { if (!cancelled) controller.error(error) }
			},
			cancel: () => { cancelled = true; return reader?.cancel() },
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
