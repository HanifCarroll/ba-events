import { redirect } from '@sveltejs/kit'
import type { RequestEvent } from '@sveltejs/kit'
import type { User } from '@supabase/supabase-js'
import type { Profile } from '#shared/lib/types.ts'
import { createSupabaseServerClient } from '#shared/lib/db/server-client.server.ts'

export interface SessionUser {
	user: User
	profile: Profile | null
	isAdmin: boolean
}

/**
 * Get the current authenticated user with their profile.
 * Returns null if not authenticated.
 */
export async function getSessionUser(event: RequestEvent): Promise<SessionUser | null> {
	const supabase = createSupabaseServerClient(event)

	const {
		data: { user },
		error
	} = await supabase.auth.getUser()

	if (error || !user) {
		return null
	}

	// Fetch profile for role information
	const { data: profile } = await supabase
		.from('profiles')
		.select('*')
		.eq('id', user.id)
		.single()

	return {
		user,
		profile: profile as Profile | null,
		isAdmin: profile?.role === 'admin'
	}
}

/**
 * Require authentication - throws redirect to /login if not authenticated.
 * Use this in load functions for protected routes.
 */
export async function requireAuth(
	event: RequestEvent,
	redirectTo?: string
): Promise<SessionUser> {
	const session = await getSessionUser(event)

	if (!session) {
		throw redirect(303, redirectTo ? `/login?redirect=${redirectTo}` : '/login')
	}

	return session
}

/**
 * Require admin role - throws redirect if not authenticated or not admin.
 * Use this in load functions for admin routes.
 */
export async function requireAdmin(
	event: RequestEvent,
	redirectTo?: string
): Promise<SessionUser> {
	const session = await getSessionUser(event)

	if (!session) {
		throw redirect(303, redirectTo ? `/login?redirect=${redirectTo}` : '/login')
	}

	if (!session.isAdmin) {
		throw redirect(303, '/')
	}

	return session
}
