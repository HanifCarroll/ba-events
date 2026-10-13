import { Data, Effect } from 'effect'
import type { RequestEvent } from '@sveltejs/kit'
import { getUserToolContextEffect } from './user-tools.server.ts'
import { failChatTurnEffect } from './turns.server.ts'
import {
	DELIVERY_AUTH_HEADER, DELIVERY_OWNER_HEADER, DELIVERY_TURN_HEADER,
	deliveryObjectName, parseDeliveryIdentity, type DeliveryIdentity,
} from '#features/chat/lib/delivery-protocol.ts'

export interface ChatDeliveryNamespace {
	idFromName(name: string): unknown
	get(id: unknown): { fetch(request: Request): Promise<Response> }
}

export function chatDeliveryBinding(event: RequestEvent): ChatDeliveryNamespace | undefined {
	return (event.platform as { env?: { CHAT_DELIVERY?: ChatDeliveryNamespace } } | undefined)?.env?.CHAT_DELIVERY
}

class ChatDeliveryError extends Data.TaggedError('ChatDeliveryError')<{ readonly cause: unknown }> {}

/** Every attach and stop rechecks the current session; a capability alone cannot cross accounts. */
export const forwardChatDeliveryEffect = Effect.fn('forwardChatDeliveryEffect')(function*(
	event: RequestEvent<Record<string, string | undefined>>, identity: DeliveryIdentity, action: 'start' | 'stream' | 'stop', body?: string,
) {
	const binding = chatDeliveryBinding(event)
	if (!binding) return new Response('Chat delivery is unavailable', { status: 503 })
	const context = yield* getUserToolContextEffect(event)
	const headers = new Headers(event.request.headers)
	headers.delete(DELIVERY_AUTH_HEADER)
	headers.set(DELIVERY_OWNER_HEADER, context.userId ?? 'guest')
	headers.set(DELIVERY_TURN_HEADER, identity.turnId)
	headers.set('x-chat-client-ip', event.getClientAddress())
	const url = new URL(event.request.url)
	url.pathname = `/${action}`
	const response = yield* Effect.tryPromise({
		try: () => binding.get(binding.idFromName(deliveryObjectName(identity))).fetch(new Request(url, {
			method: action === 'stream' ? 'GET' : 'POST', headers,
			...(body !== undefined ? { body } : {}),
		})),
		catch: (cause) => new ChatDeliveryError({ cause }),
	})
	if (action === 'stop' && response.ok && context.isAuthenticated) {
		// A Stop can precede claim acquisition, or the claim can already be superseded.
		// The delivery gate has cancelled the producer either way; cleanup cannot undo it.
		yield* Effect.match(failChatTurnEffect(event, identity.turnId, identity.attemptId), {
			onFailure: () => undefined,
			onSuccess: () => undefined,
		})
	}
	return response
})

/** Atomic delivery gate: Stop wins before this gate, persistence wins after it. */
export async function beginChatDeliveryCommit(event: RequestEvent): Promise<void> {
	const identity = parseDeliveryIdentity(event.request.headers.get(DELIVERY_TURN_HEADER), event.request.headers)
	const binding = chatDeliveryBinding(event)
	if (!identity || !binding) throw new Error('Chat delivery is unavailable')
	const response = await binding.get(binding.idFromName(deliveryObjectName(identity))).fetch(new Request('https://chat-delivery/commit', {
		method: 'POST', headers: event.request.headers,
	}))
	if (!response.ok) throw new Error('Chat turn stopped or superseded')
}
