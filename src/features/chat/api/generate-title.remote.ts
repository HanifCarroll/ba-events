import { command, getRequestEvent } from '$app/server'
import { Schema } from 'effect'
import * as generateTitle from '#features/chat/api/generate-title.server.ts'

// Remote wrapper for the authenticated title generation server function.
// Guest chats are ephemeral and use `getFallbackConversationTitle` client-side
// (see `#features/chat/state/chat.svelte.ts`), matching the legacy branching.

export const generateAndSaveTitle = command(
	Schema.toStandardSchemaV1(Schema.Struct({
		conversationId: Schema.String,
		firstMessage: Schema.String,
	})),
	async (data) =>
		generateTitle.generateAndSaveTitle(getRequestEvent(), data)
)
