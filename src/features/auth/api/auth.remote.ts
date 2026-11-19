import { command, getRequestEvent } from '$app/server'
import { Effect, Schema } from 'effect'
import type { Locale, Profile } from '#shared/lib/types.ts'
import * as server from '#features/auth/api/server.server.ts'
import { getSessionUserEffect } from '#features/auth/api/session.server.ts'

export const signOut = command(async () => Effect.runPromise(server.signOutEffect(getRequestEvent())))

const localeInput = Schema.toStandardSchemaV1(Schema.Literals(['en', 'es']))
const userIdInput = Schema.toStandardSchemaV1(Schema.Struct({ userId: Schema.String }))
const displayNameInput = Schema.toStandardSchemaV1(Schema.Struct({
	displayName: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(50)),
	expectedUserId: Schema.String,
}))

export const updateLocalePreference = command(localeInput, async (locale: Locale) =>
	Effect.runPromise(server.updateLocalePreferenceEffect(getRequestEvent(), locale))
)

export const deleteAccount = command(userIdInput, async (data: { userId: string }) =>
	Effect.runPromise(server.deleteAccountEffect(getRequestEvent(), data))
)

/** The signed-in user's profile; null when `userId` is no longer the session's user. */
export const getProfile = command(userIdInput, async ({ userId }: { userId: string }): Promise<Profile | null> => {
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
