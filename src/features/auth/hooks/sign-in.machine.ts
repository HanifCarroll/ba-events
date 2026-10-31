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

export function createAuthCallbackMachine(deps: {
	exchange: (input: { tokenHash: string; type?: string }) => Promise<unknown>
	redirect: () => void
}) {
	return setup({
		schemas: {
			context: types<{ error: string | null; tokenHash: string; tokenType?: string }>(),
			events: {
				VERIFY: types<{ tokenHash: string; tokenType?: string }>(),
				FAIL: types<{ error: string }>()
			}
		},
		actors: {
			exchange: createAsyncLogic<unknown, { tokenHash: string; type?: string }>({
				run: ({ input }) => deps.exchange(input)
			})
		}
	}).createMachine({
		context: { error: null, tokenHash: '' },
		initial: 'readingLink',
		states: {
			readingLink: {
				on: {
					VERIFY: ({ event }) => ({
						target: 'verifying',
						context: { tokenHash: event.tokenHash, tokenType: event.tokenType }
					}),
					FAIL: ({ event }) => ({ target: 'failed', context: { error: event.error } })
				}
			},
			verifying: {
				invoke: {
					src: 'exchange',
					input: ({ context }) => ({ tokenHash: context.tokenHash, type: context.tokenType }),
					onDone: { target: 'redirecting' },
					onError: ({ event }) => ({
						target: 'failed',
						context: { error: message(event.error, 'Authentication failed') }
					})
				}
			},
			redirecting: {
				entry: (_, enq) => {
					enq(deps.redirect)
				}
			},
			failed: {}
		}
	})
}
