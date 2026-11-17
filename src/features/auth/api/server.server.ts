import type { EmailOtpType } from '@supabase/supabase-js'
import type { RequestEvent } from '@sveltejs/kit'
import { Data, Effect } from 'effect'
import type { Locale } from '#shared/lib/types.ts'
import { createSupabaseServerClient } from '#shared/lib/db/server-client.server.ts'
import { getSupabaseServiceRoleClient } from '#shared/lib/db/service.server.ts'
import { boundD1Database } from '#shared/lib/db/d1.server.ts'
import { betterAuthSignOut, betterAuthStatus, platformEnv } from './better-auth.server.ts'
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

function supabaseEffect<A>(run: () => PromiseLike<A>, fallbackMessage: string) {
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
	if (betterAuthStatus(event) !== 'supabase') {
		return Effect.as(supabaseEffect(() => betterAuthSignOut(event), 'Failed to sign out'), { success: true })
	}
	const supabase = createSupabaseServerClient(event)
	return Effect.gen(function* () {
		const { error } = yield* supabaseEffect(() => supabase.auth.signOut(), 'Failed to sign out')
		if (error) return yield* Effect.fail(authFailure(error.message, error))
		return { success: true }
	})
}

export function signOut(event: RequestEvent) {
	return Effect.runPromise(signOutEffect(event))
}

/**
 * Exchange auth code or token hash for session (server-side).
 * Used for the Supabase magic link callback. Sets session cookies. Better Auth verifies its own links under /api/auth.
 */
export function exchangeCodeEffect(
	event: RequestEvent,
	data: { code?: string; tokenHash?: string; type?: string }
) {
	if (betterAuthStatus(event) !== 'supabase') return Effect.fail(authFailure('This sign-in link is no longer valid. Request a new one.'))
	const supabase = createSupabaseServerClient(event)
	return Effect.gen(function* () {
		let sessionData: { user: NonNullable<Awaited<ReturnType<typeof supabase.auth.exchangeCodeForSession>>['data']['user']> | null }
		if (data.code) {
			const result = yield* supabaseEffect(() => supabase.auth.exchangeCodeForSession(data.code!), 'Failed to exchange auth code')
			if (result.error) return yield* Effect.fail(authFailure(result.error.message, result.error))
			sessionData = result.data
		} else if (data.tokenHash && data.type) {
			const result = yield* supabaseEffect(() => supabase.auth.verifyOtp({ token_hash: data.tokenHash!, type: data.type as EmailOtpType }), 'Failed to verify magic link')
			if (result.error) return yield* Effect.fail(authFailure(result.error.message, result.error))
			if (!result.data.user) return yield* Effect.fail(authFailure('Failed to verify magic link'))
			sessionData = result.data
		} else {
			return yield* Effect.fail(authFailure('No valid auth parameters provided'))
		}
		const profileResult = yield* supabaseEffect(
			() => supabase.from('profiles').select('role').eq('id', sessionData.user!.id).single(),
			'Failed to read auth profile',
		)
		return { user: sessionData.user!, isAdmin: profileResult.data?.role === 'admin' }
	})
}

export function exchangeCode(event: RequestEvent, data: { code?: string; tokenHash?: string; type?: string }) {
	return Effect.runPromise(exchangeCodeEffect(event, data))
}

/** The session's user id, or a failure when nobody is signed in. Client-supplied ids never authorize anything. */
function sessionUserIdEffect(event: RequestEvent, action: string) {
	return Effect.flatMap(getSessionUserEffect(event), (session) =>
		session ? Effect.succeed(session.user.id) : Effect.fail(authFailure(`Must be logged in to ${action}`)))
}

/**
 * Delete the signed-in user's account. The client's `userId` only guards against a replaced account; the session
 * decides who is deleted, on D1 and on Supabase (whose service-role delete would otherwise trust the browser).
 */
export function deleteAccountEffect(event: RequestEvent, data: { userId: string }) {
	return Effect.gen(function* () {
		const userId = yield* sessionUserIdEffect(event, 'delete your account')
		if (data.userId !== userId) return yield* Effect.fail(authFailure('Account changed during deletion'))
		const db = d1Of(event)
		if (db) {
			yield* supabaseEffect(() => d1UserStore(db).deleteAccount(userId), 'Failed to delete account')
			return { success: true }
		}
		const { error } = yield* supabaseEffect(
			() => getSupabaseServiceRoleClient().auth.admin.deleteUser(userId),
			'Failed to delete account',
		)
		if (error) return yield* Effect.fail(authFailure(error.message, error))
		return { success: true }
	})
}

export function deleteAccount(event: RequestEvent, data: { userId: string }) {
	return Effect.runPromise(deleteAccountEffect(event, data))
}

/** Update the signed-in user's display name or locale in D1 `profiles`. The browser writes Supabase itself. */
export function updateProfileEffect(event: RequestEvent, patch: ProfilePatch) {
	const db = d1Of(event)
	return Effect.gen(function* () {
		if (!db) return yield* Effect.fail(authFailure('Profile updates go through Supabase on this Worker'))
		const userId = yield* sessionUserIdEffect(event, 'update your profile')
		yield* supabaseEffect(() => d1UserStore(db).updateProfile(userId, patch), 'Failed to update profile')
		return { success: true }
	})
}

/**
 * Update locale preference in profiles table (server-side).
 * Persists user's language preference across devices.
 */
export function updateLocalePreferenceEffect(event: RequestEvent, locale: Locale) {
	if (d1Of(event)) return updateProfileEffect(event, { locale })
	const supabase = createSupabaseServerClient(event)
	return Effect.gen(function* () {
		const { data: { user } } = yield* supabaseEffect(() => supabase.auth.getUser(), 'Failed to read authenticated user')
		if (!user) return yield* Effect.fail(authFailure('Must be logged in to update locale preference'))
		const { error } = yield* supabaseEffect(
			() => supabase.from('profiles').update({ locale, updated_at: new Date().toISOString() }).eq('id', user.id),
			'Failed to update locale preference',
		)
		if (error) return yield* Effect.fail(authFailure(error.message, error))
		return { success: true }
	})
}

export function updateLocalePreference(event: RequestEvent, locale: Locale) {
	return Effect.runPromise(updateLocalePreferenceEffect(event, locale))
}
