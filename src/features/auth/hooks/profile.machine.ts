import { createAsyncLogic, setup, types } from 'xstate'

const message = (error: unknown, fallback: string) =>
	error instanceof Error ? error.message : fallback

export function createProfileFormMachine(save: (name: string) => Promise<void>) {
	return setup({
		schemas: {
			context: types<{ name: string; error: string | null }>(),
			events: {
				SAVE: types<{ name: string }>(),
				INVALID: types<{ error: string }>(),
				EDIT: types<{}>(),
				RESET: types<{}>()
			}
		},
		actors: { save: createAsyncLogic<void, string>({ run: ({ input }) => save(input) }) }
	}).createMachine({
		id: 'profileForm',
		context: { name: '', error: null },
		initial: 'editing',
		on: { RESET: () => ({ target: '.editing', context: { error: null } }) },
		states: {
			editing: {
				on: {
					SAVE: ({ event }) => ({ target: 'saving', context: { name: event.name, error: null } }),
					INVALID: ({ event }) => ({ context: { error: event.error } })
				}
			},
			saving: {
				invoke: {
					src: 'save',
					input: ({ context }) => context.name,
					onDone: { target: 'saved' },
					onError: ({ event }) => ({
						target: 'editing',
						context: { error: message(event.error, 'Failed to update display name') }
					})
				}
			},
			saved: {
				after: { 3000: { target: 'editing' } },
				on: {
					EDIT: { target: 'editing' },
					SAVE: ({ event }) => ({ target: 'saving', context: { name: event.name, error: null } })
				}
			}
		}
	})
}

/** Cleanup retries resume after deletion; they never repeat the destructive request. */
export function createAccountDeletionMachine(deps: {
	remove: (userId: string) => Promise<unknown>
	signOut: (userId: string) => Promise<void>
}) {
	return setup({
		schemas: {
			context: types<{ userId: string; error: string | null }>(),
			events: { DELETE: types<{ userId: string }>(), RETRY_CLEANUP: types<{}>() }
		},
		actors: {
			remove: createAsyncLogic<unknown, string>({ run: ({ input }) => deps.remove(input) }),
			signOut: createAsyncLogic<void, string>({ run: ({ input }) => deps.signOut(input) })
		}
	}).createMachine({
		context: { userId: '', error: null },
		initial: 'confirming',
		states: {
			confirming: {
				on: {
					DELETE: ({ event }) => ({
						target: 'deleting',
						context: { userId: event.userId, error: null }
					})
				}
			},
			deleting: {
				invoke: {
					src: 'remove',
					input: ({ context }) => context.userId,
					onDone: { target: 'signingOut' },
					onError: ({ event }) => ({
						target: 'confirming',
						context: { error: message(event.error, 'Failed to delete account') }
					})
				}
			},
			signingOut: {
				invoke: {
					src: 'signOut',
					input: ({ context }) => context.userId,
					onDone: { target: 'deleted' },
					onError: ({ event }) => ({
						target: 'cleanupFailed',
						context: {
							error: `Account deleted. Signing out failed: ${message(event.error, 'Please retry to finish signing out.')}`
						}
					})
				}
			},
			cleanupFailed: {
				on: { RETRY_CLEANUP: () => ({ target: 'signingOut', context: { error: null } }) }
			},
			deleted: { type: 'final' }
		}
	})
}
