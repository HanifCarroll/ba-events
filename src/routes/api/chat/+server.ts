import type { RequestEvent } from '@sveltejs/kit'
import { Effect } from 'effect'
import { parseMainChatRequest } from '#features/chat/api/main-request.ts'
import { forwardChatDeliveryEffect } from '#features/chat/api/delivery.server.ts'
import { parseDeliveryIdentity } from '#features/chat/lib/delivery-protocol.ts'
import { requestChatTiming } from '#features/chat/lib/timing.ts'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const POST = async (event: RequestEvent): Promise<Response> => {
	const timing = requestChatTiming(event)
	timing.mark('route_entry')
	const text = await event.request.text()
	timing.mark('body_ready')
	if (new TextEncoder().encode(text).byteLength > 128 * 1024) return new Response(null, { status: 413 })
	let body
	try { body = parseMainChatRequest(JSON.parse(text)) } catch { return new Response(null, { status: 400 }) }
	const identity = parseDeliveryIdentity(body?.turnId, event.request.headers)
	if (!identity || !body || ![body.conversationId, body.userClientMessageId, body.assistantClientMessageId]
		.every((value) => typeof value === 'string' && uuid.test(value))) return new Response(null, { status: 400 })
	return Effect.runPromise(forwardChatDeliveryEffect(event, identity, 'start', text))
}
