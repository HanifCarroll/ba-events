import { createAsyncLogic, setup, types } from 'xstate'

const message = (error: unknown, fallback: string) =>
	error instanceof Error ? error.message : fallback

export function createSignInMachine(deps: {
	google: () => Promise<unknown>
	magicLink: (email: string) => Promise<unknown>
}) {
	return setup({
		schemas: {
			context: types<{ email: string; error: string | null }>(),
			events: { GOOGLE: types<{}>(), MAGIC_LINK: types<{ email: string }>(), RESET: types<{}>() }
		},
		actors: {
			google: createAsyncLogic({ run: () => deps.google() }),
			magicLink: createAsyncLogic<unknown, string>({ run: ({ input }) => deps.magicLink(input) })
		}
	}).createMachine({
		id: 'signIn',
		context: { email: '', error: null },
		initial: 'editing',
		states: {
			editing: {
				on: {
					GOOGLE: () => ({ target: 'googleRedirect', context: { error: null } }),
					MAGIC_LINK: ({ event }) => ({
						target: 'sendingLink',
						context: { email: event.email, error: null }
					})
				}
			},
			googleRedirect: {
				invoke: {
					src: 'google',
					onError: ({ event }) => ({
						target: 'editing',
						context: { error: message(event.error, 'Failed to sign in with Google') }
					})
				}
			},
			sendingLink: {
				invoke: {
					src: 'magicLink',
					input: ({ context }) => context.email,
					onDone: { target: 'linkSent' },
					onError: ({ event }) => ({
						target: 'editing',
						context: { error: message(event.error, 'Failed to send magic link') }
					})
				}
			},
			linkSent: {
				on: {
					RESET: { target: 'editing' },
					GOOGLE: () => ({ target: 'googleRedirect', context: { error: null } })
				}
			}
		}
	})
}
