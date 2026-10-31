import { createAsyncLogic, setup, types } from 'xstate'
import type { User } from '@supabase/supabase-js'
import type { Profile } from '#shared/lib/types.ts'

export interface AuthSeed {
	user?: User | null
	profile?: Profile | null
}

/** A replaced session exits its profile actor, so late responses cannot restore it. */
export function createAuthMachine(loadProfile: (userId: string) => Promise<Profile | null>) {
	return setup({
		schemas: {
			context: types<{ user: User | null; profile: Profile | null; revision: number }>(),
			input: types<AuthSeed>(),
			events: {
				SEED: types<{ value: AuthSeed }>(),
				SESSION_CHANGED: types<{ user: User | null }>(),
				PROFILE_UPDATED: types<{ userId: string; profile: Profile | null; revision: number }>()
			}
		},
		actors: {
			profile: createAsyncLogic<{ profile: Profile | null }, string>({
				run: async ({ input }) => ({ profile: await loadProfile(input) })
			})
		}
	}).createMachine({
		id: 'auth',
		context: ({ input }) => ({
			user: input.user ?? null,
			profile: input.profile ?? null,
			revision: 0
		}),
		initial: 'seeded',
		on: {
			SEED: ({ context, event }) => ({
				target: '.seeded',
				context: {
					user: event.value.user ?? null,
					profile: event.value.profile ?? null,
					revision: context.revision + (context.user?.id === event.value.user?.id ? 0 : 1)
				}
			}),
			// Same-account token refreshes retain the generation of a pending mutation.
			SESSION_CHANGED: ({ context, event }) => {
				if (!event.user)
					return {
						target: '.anonymous',
						context: {
							user: null,
							profile: null,
							revision: context.revision + (context.user ? 1 : 0)
						}
					}
				return {
					target: '.loadingProfile',
					reenter: true,
					context: {
						user: event.user,
						profile: context.user?.id === event.user.id ? context.profile : null,
						revision: context.revision + (context.user?.id === event.user.id ? 0 : 1)
					}
				}
			},
			PROFILE_UPDATED: ({ context, event }) => {
				if (context.user?.id !== event.userId || context.revision !== event.revision) return
				return { target: '.authenticated', context: { profile: event.profile } }
			}
		},
		states: {
			seeded: {
				always: ({ context }) => ({ target: context.user ? 'authenticated' : 'anonymous' })
			},
			anonymous: {},
			loadingProfile: {
				invoke: {
					src: 'profile',
					input: ({ context }) => context.user!.id,
					onDone: ({ event }) => ({
						target: 'authenticated',
						context: { profile: event.output.profile }
					}),
					onError: { target: 'profileUnavailable' }
				}
			},
			authenticated: {},
			profileUnavailable: {}
		}
	})
}
