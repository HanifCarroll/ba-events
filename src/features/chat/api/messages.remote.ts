import { command, getRequestEvent } from '$app/server'
import { Effect, Schema } from 'effect'
import * as messages from '#features/chat/api/messages.server.ts'
import type {
	MessageAttachedData,
	MessageExecutionStep,
	MessageRole
} from '#shared/lib/types.ts'

export interface AddMessageInput {
	conversationId: string
	parentMessageId?: string | null
	role: MessageRole
	clientMessageId?: string
	content: string
	visibleContent?: string
	executionTrace?: MessageExecutionStep[]
	responseContractVersion?: number
	attachedData?: MessageAttachedData
}

const addMessageInput = Schema.toStandardSchemaV1(Schema.Struct({
	conversationId: Schema.String,
	parentMessageId: Schema.optional(Schema.NullOr(Schema.String)),
	role: Schema.Literals(['user', 'assistant', 'system']),
	clientMessageId: Schema.optional(Schema.String),
	content: Schema.String,
	visibleContent: Schema.optional(Schema.String),
	executionTrace: Schema.optional(Schema.Any),
	responseContractVersion: Schema.optional(Schema.Number),
	attachedData: Schema.optional(Schema.Any),
}))
const updateMessageInput = Schema.toStandardSchemaV1(Schema.Struct({
	messageId: Schema.String,
	attachedData: Schema.Any,
}))

export const addMessage = command(addMessageInput, async (data) =>
	Effect.runPromise(messages.addMessageEffect(getRequestEvent(), data as AddMessageInput))
)

export const updateMessageAttachedData = command(
	updateMessageInput,
	async (data) =>
		Effect.runPromise(messages.updateMessageAttachedDataEffect(getRequestEvent(), data as { messageId: string; attachedData: MessageAttachedData }))
)
