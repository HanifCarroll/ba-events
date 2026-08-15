import { command, getRequestEvent } from '$app/server'
import * as generateTitle from '#features/chat/api/generate-title.server.ts'

// Remote wrapper for the authenticated title generation server function.
// Guest chats are ephemeral and use `getFallbackConversationTitle` client-side
// (see `#features/chat/state/chat.svelte.ts`), matching the legacy branching.

export const generateAndSaveTitle = command(
	'unchecked',
	async (data: { conversationId: string; firstMessage: string }) =>
		generateTitle.generateAndSaveTitle(getRequestEvent(), data)
)
