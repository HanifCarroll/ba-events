import type { EmailOtpType } from '@supabase/supabase-js'
import type { RequestEvent } from '@sveltejs/kit'
import { Data, Effect } from 'effect'
import type { Locale } from '#shared/lib/types.ts'
import { createSupabaseServerClient } from '#shared/lib/db/server-client.server.ts'
import { getSupabaseServiceRoleClient } from '#shared/lib/db/service.server.ts'

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
 * Used for magic link callback. Sets session cookies.
 */
export function exchangeCodeEffect(
	event: RequestEvent,
	data: { code?: string; tokenHash?: string; type?: string }
) {
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

// Delete user account - requires service role key (server-side only)
export function deleteAccountEffect(_event: RequestEvent, data: { userId: string }) {
	const adminClient = getSupabaseServiceRoleClient()
	return Effect.gen(function* () {
		const { error } = yield* supabaseEffect(
			() => adminClient.auth.admin.deleteUser(data.userId),
			'Failed to delete account',
		)
		if (error) return yield* Effect.fail(authFailure(error.message, error))
		return { success: true }
	})
}

export function deleteAccount(event: RequestEvent, data: { userId: string }) {
	return Effect.runPromise(deleteAccountEffect(event, data))
}

/**
 * Update locale preference in profiles table (server-side).
 * Persists user's language preference across devices.
 */
export function updateLocalePreferenceEffect(event: RequestEvent, locale: Locale) {
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
