import { redirect } from '@sveltejs/kit'
import { Data, Effect } from 'effect'
import type { RequestEvent } from '@sveltejs/kit'
import type { AuthUser, Profile } from '#shared/lib/types.ts'
import { boundD1Database } from '#shared/lib/db/d1.server.ts'
import { betterAuthUser, platformEnv } from './better-auth.server.ts'
import { d1UserStore } from './user-store.server.ts'

export type { AuthUser }

export interface SessionUser {
	user: AuthUser
	profile: Profile | null
	isAdmin: boolean
}

class SessionLookupError extends Data.TaggedError('SessionLookupError')<{
	readonly message: string
	readonly cause?: unknown
}> {}

const sessionOf = (user: AuthUser, profile: Profile | null): SessionUser => ({ user, profile, isAdmin: profile?.role === 'admin' })

/** Better Auth on D1, for a Worker that binds `DB`. Without AUTH_SECRET nobody is signed in. */
function betterAuthSessionEffect(event: RequestEvent) {
	return Effect.gen(function* () {
		const user = yield* Effect.tryPromise({
			try: () => betterAuthUser(event),
			catch: (cause) => new SessionLookupError({ message: 'Failed to read the session', cause }),
		})
		if (!user) return null
		const profile = yield* Effect.match(
			Effect.tryPromise({
				try: () => d1UserStore(boundD1Database(platformEnv(event))!).profile(user.id),
				catch: () => new SessionLookupError({ message: 'Failed to read profile' }),
			}),
			{ onFailure: () => null, onSuccess: (row) => row },
		)
		return sessionOf(user, profile)
	})
}

/**
 * Get the current authenticated user with their profile.
 * Returns null if not authenticated.
 */
export function getSessionUserEffect(event: RequestEvent): Effect.Effect<SessionUser | null, never> {
	return Effect.match(betterAuthSessionEffect(event), {
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
