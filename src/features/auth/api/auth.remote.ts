import { command, getRequestEvent } from '$app/server'
import { Effect, Schema } from 'effect'
import type { Locale, Profile } from '#shared/lib/types.ts'
import * as server from '#features/auth/api/server.server.ts'
import { getSessionUserEffect } from '#features/auth/api/session.server.ts'
import { betterAuthStatus } from '#features/auth/api/better-auth.server.ts'

// Remote wrappers for the auth server functions (CONTRACTS.md §5).
// `getSessionUser` is intentionally NOT wrapped — the root layout's load data
// covers it (see src/routes/+layout.server.ts). `getProfile` and
// `updateDisplayName` serve Better Auth (a Worker that binds D1) only; with
// Supabase the browser reads and writes `profiles` itself. They take the user
// from the server session; a user id sent by the browser only guards against a
// replaced account.

export const signOut = command(async () => Effect.runPromise(server.signOutEffect(getRequestEvent())))

const exchangeCodeInput = Schema.toStandardSchemaV1(Schema.Struct({
	code: Schema.optional(Schema.String),
	tokenHash: Schema.optional(Schema.String),
	type: Schema.optional(Schema.String),
}))
const localeInput = Schema.toStandardSchemaV1(Schema.Literals(['en', 'es']))
const userIdInput = Schema.toStandardSchemaV1(Schema.Struct({ userId: Schema.String }))
const displayNameInput = Schema.toStandardSchemaV1(Schema.Struct({
	displayName: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(50)),
	expectedUserId: Schema.String,
}))

export const exchangeCode = command(exchangeCodeInput, async (data: { code?: string; tokenHash?: string; type?: string }) =>
	Effect.runPromise(server.exchangeCodeEffect(getRequestEvent(), data))
)

export const updateLocalePreference = command(localeInput, async (locale: Locale) =>
	Effect.runPromise(server.updateLocalePreferenceEffect(getRequestEvent(), locale))
)

export const deleteAccount = command(userIdInput, async (data: { userId: string }) =>
	Effect.runPromise(server.deleteAccountEffect(getRequestEvent(), data))
)

/** The signed-in user's profile; null when `userId` is no longer the session's user. */
export const getProfile = command(userIdInput, async ({ userId }: { userId: string }): Promise<Profile | null> => {
	if (betterAuthStatus(getRequestEvent()) === 'supabase') throw new Error('Profiles are read through Supabase on this Worker')
	const session = await Effect.runPromise(getSessionUserEffect(getRequestEvent()))
	return session?.user.id === userId ? session.profile : null
})

export const updateDisplayName = command(displayNameInput, async ({ displayName, expectedUserId }: { displayName: string; expectedUserId: string }) => {
	const event = getRequestEvent()
	const session = await Effect.runPromise(getSessionUserEffect(event))
	if (!session) throw new Error('Must be logged in to update profile')
	if (session.user.id !== expectedUserId) throw new Error('Account changed during profile update')
	return Effect.runPromise(server.updateProfileEffect(event, { display_name: displayName }))
})
