import type { RequestEvent } from '@sveltejs/kit'
import { Data, Effect } from 'effect'
import type { Locale } from '#shared/lib/types.ts'
import { boundD1Database } from '#shared/lib/db/d1.server.ts'
import { betterAuthSignOut, platformEnv } from './better-auth.server.ts'
import { getSessionUserEffect } from './session.server.ts'
import { d1UserStore, type ProfilePatch } from './user-store.server.ts'

const d1Of = (event: RequestEvent) => boundD1Database(platformEnv(event))

// ============================================
// Server-side auth functions (cookie-based)
// ============================================

class AuthServiceError extends Data.TaggedError('AuthServiceError')<{
	readonly message: string
	readonly cause?: unknown
}> {}

const authFailure = (message: string, cause?: unknown) => new AuthServiceError({ message, cause })

function authEffect<A>(run: () => PromiseLike<A>, fallbackMessage: string) {
	return Effect.tryPromise({
		try: run,
		catch: (cause) => authFailure(cause instanceof Error && cause.message ? cause.message : fallbackMessage, cause),
	})
}

/**
 * Sign out (server-side).
 * Clears session cookies.
 */
export function signOutEffect(event: RequestEvent) {
	return Effect.as(authEffect(() => betterAuthSignOut(event), 'Failed to sign out'), { success: true })
}

export function signOut(event: RequestEvent) {
	return Effect.runPromise(signOutEffect(event))
}

/** The session's user id, or a failure when nobody is signed in. Client-supplied ids never authorize anything. */
function sessionUserIdEffect(event: RequestEvent, action: string) {
	return Effect.flatMap(getSessionUserEffect(event), (session) =>
		session ? Effect.succeed(session.user.id) : Effect.fail(authFailure(`Must be logged in to ${action}`)))
}

/**
 * Delete the signed-in user's account. The client's `userId` only guards against a replaced account; the session
 * decides who is deleted.
 */
export function deleteAccountEffect(event: RequestEvent, data: { userId: string }) {
	return Effect.gen(function* () {
		const userId = yield* sessionUserIdEffect(event, 'delete your account')
		if (data.userId !== userId) return yield* authFailure('Account changed during deletion')
		const db = d1Of(event)
		if (!db) return yield* authFailure('Missing DB binding')
		yield* authEffect(() => d1UserStore(db).deleteAccount(userId), 'Failed to delete account')
		return { success: true }
	})
}

export function deleteAccount(event: RequestEvent, data: { userId: string }) {
	return Effect.runPromise(deleteAccountEffect(event, data))
}

/** Update the signed-in user's display name or locale in D1 `profiles`. */
export function updateProfileEffect(event: RequestEvent, patch: ProfilePatch) {
	const db = d1Of(event)
	return Effect.gen(function* () {
		if (!db) return yield* authFailure('Missing DB binding')
		const userId = yield* sessionUserIdEffect(event, 'update your profile')
		yield* authEffect(() => d1UserStore(db).updateProfile(userId, patch), 'Failed to update profile')
		return { success: true }
	})
}

/**
 * Update locale preference in profiles table (server-side).
 * Persists user's language preference across devices.
 */
export function updateLocalePreferenceEffect(event: RequestEvent, locale: Locale) {
	return updateProfileEffect(event, { locale })
}

export function updateLocalePreference(event: RequestEvent, locale: Locale) {
	return Effect.runPromise(updateLocalePreferenceEffect(event, locale))
}
