import { command, getRequestEvent } from '$app/server'
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

export const addMessage = command('unchecked', async (data: AddMessageInput) =>
	messages.addMessage(getRequestEvent(), data)
)

export const updateMessageAttachedData = command(
	'unchecked',
	async (data: { messageId: string; attachedData: MessageAttachedData }) =>
		messages.updateMessageAttachedData(getRequestEvent(), data)
)
