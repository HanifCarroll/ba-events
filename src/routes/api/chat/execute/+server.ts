import type { RequestEvent } from '@sveltejs/kit'
import { verifyChatExecution } from '#features/chat/api/delivery-auth.server.ts'
import { POST as executeChat } from '#features/chat/api/execute.server.ts'

export const POST = async (event: RequestEvent): Promise<Response> => {
	const secret = (event.platform as { env?: { CHAT_DELIVERY_SECRET?: string } } | undefined)?.env?.CHAT_DELIVERY_SECRET
	if (!await verifyChatExecution(event.request.headers, secret)) return new Response(null, { status: 404 })
	return executeChat(event)
}
