import { createAsyncLogic, setup, types } from 'xstate'
import type { ConversationListItem } from '#shared/lib/types.ts'

/** Identity replacement clears rows; same-account refreshes keep the last good list. */
export function createConversationHistoryMachine(
	read: () => Promise<{ conversations: ConversationListItem[] }>
) {
	return setup({
		schemas: {
			context: types<{
				userId: string | null
				version: number
				conversations: ConversationListItem[]
			}>(),
			events: { SYNC: types<{ userId: string | null; version: number }>(), RETRY: types<{}>() }
		},
		actors: { read: createAsyncLogic({ run: () => read() }) }
	}).createMachine({
		id: 'conversationHistory',
		context: { userId: null, version: -1, conversations: [] },
		initial: 'anonymous',
		on: {
			SYNC: ({ context, event }) => {
				if (!event.userId)
					return { target: '.anonymous', context: { userId: null, version: -1, conversations: [] } }
				if (context.userId !== event.userId)
					return {
						target: '.loading',
						reenter: true,
						context: { userId: event.userId, version: event.version, conversations: [] }
					}
				if (context.version !== event.version)
					return { target: '.loading', reenter: true, context: { version: event.version } }
			},
			RETRY: ({ context }) => {
				if (context.userId) return { target: '.loading', reenter: true }
			}
		},
		states: {
			anonymous: {},
			loading: {
				invoke: {
					src: 'read',
					onDone: ({ event }) => ({
						target: 'ready',
						context: { conversations: event.output.conversations }
					}),
					onError: { target: 'failed' }
				}
			},
			ready: {},
			failed: {}
		}
	})
}
