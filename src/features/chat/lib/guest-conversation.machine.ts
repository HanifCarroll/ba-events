import { createAsyncLogic, setup, types } from 'xstate'
import type { GuestConversationWithMessages } from '#shared/lib/db/guest-conversations.ts'

export type GuestConversationRead = { conversation: GuestConversationWithMessages | null }

export const guestConversationMachine = setup({
	schemas: {
		context: types<{ id: string | null; conversation: GuestConversationWithMessages | null }>(),
		events: {
			LOAD: types<{ id: string }>(), CLEAR: types<{}>(),
			REPLACE: types<{ conversation: GuestConversationWithMessages | null }>()
		}
	},
	actors: {
		load: createAsyncLogic<GuestConversationRead, string>({ run: async () => ({ conversation: null }) })
	}
}).createMachine({
	id: 'guestConversation',
	initial: 'idle',
	context: { id: null, conversation: null },
	on: {
		LOAD: ({ event }) => ({ target: '.loading', reenter: true, context: { id: event.id, conversation: null } }),
		CLEAR: () => ({ target: '.idle', context: { id: null, conversation: null } }),
		REPLACE: ({ event }) => ({ target: '.loaded', context: { id: event.conversation?.conversation.id ?? null, conversation: event.conversation } })
	},
	states: {
		idle: {},
		loading: {
			invoke: {
				src: 'load', input: ({ context }) => context.id!,
				onDone: ({ event }) => ({ target: 'loaded', context: { conversation: event.output.conversation } }),
				onError: { target: 'failed' }
			}
		},
		loaded: {},
		failed: {}
	}
})
