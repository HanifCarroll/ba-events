import { Data, Effect } from 'effect'
import type { RequestEvent } from '@sveltejs/kit'
import { getUserToolContextEffect } from './user-tools.server.ts'
import { failChatTurnEffect } from './turns.server.ts'
import {
	DELIVERY_AUTH_HEADER, DELIVERY_OWNER_HEADER, DELIVERY_TURN_HEADER,
	deliveryObjectName, parseDeliveryIdentity, type DeliveryIdentity,
} from '#features/chat/lib/delivery-protocol.ts'
import { EXECUTION_FENCE_HEADER, EXECUTION_STAGE_HEADER, parseCheckpoint, type RecoveryCheckpoint } from '../../../chat-delivery-worker/recovery.ts'
import { requestChatTiming } from '#features/chat/lib/timing.ts'

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
	const timing = requestChatTiming(event)
	const context = yield* getUserToolContextEffect(event)
	timing.mark('identity_ready')
	const headers = new Headers(event.request.headers)
	headers.delete(DELIVERY_AUTH_HEADER)
	headers.delete(EXECUTION_FENCE_HEADER)
	headers.delete(EXECUTION_STAGE_HEADER)
	headers.set(DELIVERY_OWNER_HEADER, context.userId ?? 'guest')
	headers.set(DELIVERY_TURN_HEADER, identity.turnId)
	headers.set('x-chat-client-ip', event.getClientAddress())
	const url = new URL(event.request.url)
	url.pathname = `/${action}`
	timing.mark('delivery_forward_start')
	const response = yield* Effect.tryPromise({
		try: () => binding.get(binding.idFromName(deliveryObjectName(identity))).fetch(new Request(url, {
			method: action === 'stream' ? 'GET' : 'POST', headers,
			...(body !== undefined ? { body } : {}),
		})),
		catch: (cause) => new ChatDeliveryError({ cause }),
	})
	timing.mark('delivery_headers')
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

async function checkpointRequest(event: RequestEvent, checkpoint?: RecoveryCheckpoint): Promise<Response> {
	const identity = parseDeliveryIdentity(event.request.headers.get(DELIVERY_TURN_HEADER), event.request.headers)
	const binding = chatDeliveryBinding(event)
	if (!identity || !binding) throw new Error('Chat delivery is unavailable')
	return binding.get(binding.idFromName(deliveryObjectName(identity))).fetch(new Request('https://chat-delivery/checkpoint', {
		method: checkpoint ? 'POST' : 'GET', headers: event.request.headers,
		...(checkpoint ? { body: JSON.stringify(checkpoint) } : {}),
	}))
}

/** A server-produced final response is checkpointed before ownership-gated persistence. */
export async function saveChatDeliveryCheckpoint(event: RequestEvent, checkpoint: RecoveryCheckpoint): Promise<void> {
	const response = await checkpointRequest(event, checkpoint)
	if (!response.ok) throw new Error('Chat response checkpoint rejected')
}

export async function getChatDeliveryCheckpoint(event: RequestEvent): Promise<RecoveryCheckpoint | null> {
	const response = await checkpointRequest(event)
	if (!response.ok) throw new Error('Chat response checkpoint unavailable')
	const input: unknown = await response.json()
	if (input === null) return null
	const checkpoint = parseCheckpoint(input)
	if (!checkpoint) throw new Error('Invalid chat response checkpoint')
	return checkpoint
}
