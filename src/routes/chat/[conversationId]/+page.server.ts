import type { PageServerLoad } from './$types'
import { getConversation } from '#features/chat/api/conversations.server.ts'

export const load: PageServerLoad = async (event) => {
	const { conversationId } = event.params

	// Guests have no server record: return an empty shell and let the client
	// read the conversation from the Dexie IndexedDB store (legacy
	// `useGuestConversation`). We use `event.locals.user` (populated by the S1
	// auth handle) to avoid a second Supabase round-trip on the common guest
	// path.
	if (!event.locals.user) {
		return { conversation: null }
	}

	// Signed-in users: load the conversation + messages server-side so the
	// timeline renders on first paint. `getConversation` returns null when the
	// conversation does not exist or belongs to another user — the legacy UI
	// renders `chat_conversation_not_found` in that case (it never called
	// notFound()/404), so null is the faithful mapping.
	const conversation = await getConversation(event, { id: conversationId })
	return { conversation }
}
