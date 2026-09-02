import type { UIMessage } from 'ai'
import { Schema } from 'effect'

/** The AI SDK owns the UIMessage shape; only this route's control fields are decoded here. */
const mainChatRequestSchema = Schema.Struct({
	// The AI SDK owns `UIMessage`; these fields are intentionally decoded as
	// unknown and normalized below to retain the route's legacy defaults.
	messages: Schema.optional(Schema.Unknown),
	locale: Schema.optional(Schema.Unknown),
	happeningSoonEventId: Schema.optional(Schema.Unknown),
	happeningSoonEventIds: Schema.optional(Schema.Unknown),
	conversationId: Schema.optional(Schema.Unknown),
	userClientMessageId: Schema.optional(Schema.Unknown),
	assistantClientMessageId: Schema.optional(Schema.Unknown),
	turnId: Schema.optional(Schema.Unknown),
	retry: Schema.optional(Schema.Unknown),
})

export interface MainChatRequest {
	messages?: UIMessage[]
	locale?: 'en' | 'es'
	happeningSoonEventId?: string
	happeningSoonEventIds?: unknown[]
	conversationId?: string | null
	userClientMessageId?: string | null
	assistantClientMessageId?: string | null
	turnId?: string | null
	retry?: boolean
}

export function parseMainChatRequest(body: unknown): MainChatRequest | null {
	const parsed = Schema.decodeUnknownResult(mainChatRequestSchema)(body)
	if (parsed._tag !== 'Success') return null
	const input = parsed.success
	return {
		...(Array.isArray(input.messages) ? { messages: input.messages as UIMessage[] } : {}),
		...(input.locale === 'es' || input.locale === 'en' ? { locale: input.locale } : {}),
		...(typeof input.happeningSoonEventId === 'string'
			? { happeningSoonEventId: input.happeningSoonEventId }
			: {}),
		...(Array.isArray(input.happeningSoonEventIds)
			? { happeningSoonEventIds: input.happeningSoonEventIds }
			: {}),
		...(typeof input.conversationId === 'string' || input.conversationId === null
			? { conversationId: input.conversationId }
			: {}),
		...(typeof input.userClientMessageId === 'string' || input.userClientMessageId === null
			? { userClientMessageId: input.userClientMessageId }
			: {}),
		...(typeof input.assistantClientMessageId === 'string' || input.assistantClientMessageId === null
			? { assistantClientMessageId: input.assistantClientMessageId }
			: {}),
		...(typeof input.turnId === 'string' || input.turnId === null
			? { turnId: input.turnId }
			: {}),
		...(typeof input.retry === 'boolean' ? { retry: input.retry } : {}),
	}
}
