import type { RequestEvent } from './$types'
import { Effect } from 'effect'
import { forwardChatDeliveryEffect } from '#features/chat/api/delivery.server.ts'
import { parseDeliveryIdentity } from '#features/chat/lib/delivery-protocol.ts'

export const GET = (event: RequestEvent): Promise<Response> => {
	const identity = parseDeliveryIdentity(event.params.turnId, event.request.headers)
	return identity ? Effect.runPromise(forwardChatDeliveryEffect(event, identity, 'stream'))
		: Promise.resolve(new Response(null, { status: 400 }))
}
