import { createAsyncLogic, setup, types } from 'xstate'

interface Membership {
	userId: string | null
	eventId: string
	saved: boolean
}

export function createSavedMembershipMachine(deps: {
	read: (eventId: string, userId: string) => Promise<boolean>
	write: (eventId: string, userId: string, saved: boolean) => Promise<unknown>
	changed: (value: Membership) => void
	failed: (error: unknown) => void
}) {
	return setup({
		schemas: {
			context: types<Membership>(),
			events: {
				SYNC: types<{ userId: string | null; eventId: string; initialSaved: boolean }>(),
				TOGGLE: types<{}>()
			}
		},
		actors: {
			read: createAsyncLogic<boolean, Membership>({
				run: ({ input }) => deps.read(input.eventId, input.userId!)
			}),
			write: createAsyncLogic<unknown, Membership>({
				run: ({ input }) => deps.write(input.eventId, input.userId!, input.saved)
			})
		}
	}).createMachine({
		id: 'savedMembership',
		context: { userId: null, eventId: '', saved: false },
		initial: 'anonymous',
		on: {
			SYNC: ({ context, event }) => {
				if (!event.userId)
					return {
						target: '.anonymous',
						context: { userId: null, eventId: event.eventId, saved: false }
					}
				if (context.userId === event.userId && context.eventId === event.eventId) return
				return {
					target: '.loading',
					reenter: true,
					context: { userId: event.userId, eventId: event.eventId, saved: event.initialSaved }
				}
			}
		},
		states: {
			anonymous: {},
			loading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: ({ event }) => ({ target: 'ready', context: { saved: event.output } }),
					onError: ({ event }, enq) => {
						enq(deps.failed, event.error)
						return { target: 'loadFailed' }
					}
				}
			},
			loadFailed: { on: { TOGGLE: { target: 'loading' } } },
			ready: {
				on: {
					TOGGLE: ({ context }) => ({ target: 'updating', context: { saved: !context.saved } })
				}
			},
			updating: {
				invoke: {
					src: 'write',
					input: ({ context }) => context,
					onDone: ({ context }, enq) => {
						enq(deps.changed, context)
						return { target: 'ready' }
					},
					onError: ({ context, event }, enq) => {
						enq(deps.failed, event.error)
						return { target: 'ready', context: { saved: !context.saved } }
					}
				}
			}
		}
	})
}
