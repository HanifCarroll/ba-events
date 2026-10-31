import { createAsyncLogic, setup, types } from 'xstate'
import type { SavedEventWithDetails } from '#shared/lib/types.ts'

export function createSavedListMachine(read: (userId: string) => Promise<SavedEventWithDetails[]>) {
	return setup({
		schemas: {
			context: types<{
				userId: string | null
				events: SavedEventWithDetails[]
				error: string | null
			}>(),
			events: { IDENTITY: types<{ userId: string | null }>(), REFRESH: types<{}>() }
		},
		actors: {
			read: createAsyncLogic<SavedEventWithDetails[], string>({ run: ({ input }) => read(input) })
		}
	}).createMachine({
		id: 'savedList',
		context: { userId: null, events: [], error: null },
		initial: 'anonymous',
		on: {
			IDENTITY: ({ context, event }) => {
				if (!event.userId)
					return { target: '.anonymous', context: { userId: null, events: [], error: null } }
				if (context.userId === event.userId) return
				return {
					target: '.loading',
					reenter: true,
					context: { userId: event.userId, events: [], error: null }
				}
			},
			REFRESH: ({ context }) => {
				if (!context.userId) return
				return { target: '.loading', reenter: true, context: { error: null } }
			}
		},
		states: {
			anonymous: {},
			loading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context.userId!,
					onDone: ({ event }) => ({ target: 'ready', context: { events: event.output } }),
					onError: () => ({ target: 'failed', context: { error: 'Failed to load saved events' } })
				}
			},
			ready: {},
			failed: {}
		}
	})
}
