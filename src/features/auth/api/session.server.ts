import { redirect } from '@sveltejs/kit'
import { Data, Effect } from 'effect'
import type { RequestEvent } from '@sveltejs/kit'
import type { User } from '@supabase/supabase-js'
import type { Profile } from '#shared/lib/types.ts'
import { createSupabaseServerClient } from '#shared/lib/db/server-client.server.ts'

export interface SessionUser {
	user: User
	profile: Profile | null
	isAdmin: boolean
}

class SessionLookupError extends Data.TaggedError('SessionLookupError')<{
	readonly message: string
	readonly cause?: unknown
}> {}

/**
 * Get the current authenticated user with their profile.
 * Returns null if not authenticated.
 */
export function getSessionUserEffect(event: RequestEvent): Effect.Effect<SessionUser | null, never> {
	const program = Effect.gen(function* () {
		const supabase = createSupabaseServerClient(event)
		const {
			data: { user },
			error
		} = yield* Effect.tryPromise({
			try: () => supabase.auth.getUser(),
			catch: (cause) => new SessionLookupError({ message: 'Failed to read authenticated user', cause }),
		})
		if (error || !user) return null

		const profileResult = yield* Effect.match(
			Effect.tryPromise({
				try: () => supabase.from('profiles').select('*').eq('id', user.id).single(),
				catch: () => new SessionLookupError({ message: 'Failed to read profile' }),
			}),
			{ onFailure: () => null, onSuccess: ({ data }) => data },
		)
		return { user, profile: profileResult as Profile | null, isAdmin: (profileResult as Profile | null)?.role === 'admin' }
	})
	return Effect.match(program, {
		onFailure: () => null,
		onSuccess: (session) => session,
	})
}

export function getSessionUser(event: RequestEvent) {
	return Effect.runPromise(getSessionUserEffect(event))
}

/**
 * Require authentication - throws redirect to /login if not authenticated.
 * Use this in load functions for protected routes.
 */
export function requireAuthEffect(
	event: RequestEvent,
	redirectTo?: string
): Effect.Effect<SessionUser, never> {
	return Effect.map(getSessionUserEffect(event), (session) => {
		if (!session) throw redirect(303, redirectTo ? `/login?redirect=${redirectTo}` : '/login')
		return session
	})
}

export function requireAuth(event: RequestEvent, redirectTo?: string) {
	return Effect.runPromise(requireAuthEffect(event, redirectTo))
}

/**
 * Require admin role - throws redirect if not authenticated or not admin.
 * Use this in load functions for admin routes.
 */
export function requireAdminEffect(
	event: RequestEvent,
	redirectTo?: string
): Effect.Effect<SessionUser, never> {
	return Effect.map(getSessionUserEffect(event), (session) => {
		if (!session) throw redirect(303, redirectTo ? `/login?redirect=${redirectTo}` : '/login')
		if (!session.isAdmin) throw redirect(303, '/')
		return session
	})
}

export function requireAdmin(event: RequestEvent, redirectTo?: string) {
	return Effect.runPromise(requireAdminEffect(event, redirectTo))
}
