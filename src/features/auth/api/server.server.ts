import type { EmailOtpType } from '@supabase/supabase-js'
import type { RequestEvent } from '@sveltejs/kit'
import type { Locale } from '#shared/lib/types.ts'
import { createSupabaseServerClient } from '#shared/lib/db/server-client.server.ts'
import { getSupabaseServiceRoleClient } from '#shared/lib/db/service.server.ts'

// ============================================
// Server-side auth functions (cookie-based)
// ============================================

/**
 * Sign out (server-side).
 * Clears session cookies.
 */
export async function signOut(event: RequestEvent) {
	const supabase = createSupabaseServerClient(event)
	await supabase.auth.signOut()
	return { success: true }
}

/**
 * Exchange auth code or token hash for session (server-side).
 * Used for magic link callback. Sets session cookies.
 */
export async function exchangeCode(
	event: RequestEvent,
	data: { code?: string; tokenHash?: string; type?: string }
) {
	const supabase = createSupabaseServerClient(event)

	// Handle PKCE code exchange
	if (data.code) {
		const { data: sessionData, error } = await supabase.auth.exchangeCodeForSession(data.code)

		if (error) {
			throw error
		}

		// Fetch profile for redirect decision
		const { data: profile } = await supabase
			.from('profiles')
			.select('role')
			.eq('id', sessionData.user.id)
			.single()

		return {
			user: sessionData.user,
			isAdmin: profile?.role === 'admin'
		}
	}

	// Handle token hash (magic link with PKCE)
	if (data.tokenHash && data.type) {
		const { data: sessionData, error } = await supabase.auth.verifyOtp({
			token_hash: data.tokenHash,
			type: data.type as EmailOtpType
		})

		if (error) {
			throw error
		}

		if (!sessionData.user) {
			throw new Error('Failed to verify magic link')
		}

		// Fetch profile for redirect decision
		const { data: profile } = await supabase
			.from('profiles')
			.select('role')
			.eq('id', sessionData.user.id)
			.single()

		return {
			user: sessionData.user,
			isAdmin: profile?.role === 'admin'
		}
	}

	throw new Error('No valid auth parameters provided')
}

// Delete user account - requires service role key (server-side only)
export async function deleteAccount(event: RequestEvent, data: { userId: string }) {
	const adminClient = getSupabaseServiceRoleClient()

	// Delete user from auth.users (CASCADE will handle profiles and saved_events)
	const { error } = await adminClient.auth.admin.deleteUser(data.userId)

	if (error) {
		throw error
	}

	return { success: true }
}

/**
 * Update locale preference in profiles table (server-side).
 * Persists user's language preference across devices.
 */
export async function updateLocalePreference(event: RequestEvent, locale: Locale) {
	const supabase = createSupabaseServerClient(event)
	const {
		data: { user }
	} = await supabase.auth.getUser()

	if (!user) {
		throw new Error('Must be logged in to update locale preference')
	}

	const { error } = await supabase
		.from('profiles')
		.update({ locale, updated_at: new Date().toISOString() })
		.eq('id', user.id)

	if (error) {
		throw error
	}

	return { success: true }
}
