import { createBrowserClient as createSupabaseBrowserClient } from '@supabase/ssr'
import type { SupabaseClient, Session } from '@supabase/supabase-js'
import { browser, dev } from '$app/env'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$app/env/public'
import type { Profile } from '#shared/lib/types.ts'

// Browser-side Supabase client for auth
// Note: These are public keys, safe to expose to browser

type BrowserClient = SupabaseClient

let browserClient: BrowserClient | null = null

function createBrowserAuthClient(): BrowserClient {
	if (!PUBLIC_SUPABASE_URL || !PUBLIC_SUPABASE_ANON_KEY) {
		throw new Error('Missing PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_ANON_KEY')
	}
	const client = createSupabaseBrowserClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)

	// Expose on window for debugging in development
	if (browser && dev) {
		;(window as unknown as Record<string, unknown>).__supabase = client
	}

	return client
}

export function getSupabaseBrowserClient(): BrowserClient {
	if (!browser) {
		throw new Error('getSupabaseBrowserClient should only be called on the client')
	}

	if (!browserClient) {
		browserClient = createBrowserAuthClient()
	}

	return browserClient
}

// Reset the browser client (useful when connection goes stale)
export function resetSupabaseBrowserClient() {
	if (!browser) return
	browserClient = null
}

// Wrapper that adds timeout and retry logic for stale connections
async function withConnectionRetry<T>(
	operation: (client: BrowserClient) => Promise<T>,
	timeoutMs = 10000
): Promise<T> {
	const attempt = async (isRetry = false): Promise<T> => {
		if (isRetry) {
			console.warn('Supabase connection appears stale, resetting client...')
			resetSupabaseBrowserClient()
		}

		const client = getSupabaseBrowserClient()

		// Race the operation against a timeout
		const timeoutPromise = new Promise<never>((_, reject) => {
			setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
		})

		try {
			return await Promise.race([operation(client), timeoutPromise])
		} catch (err) {
			if (!isRetry && err instanceof Error && err.message === 'Connection timeout') {
				return attempt(true)
			}
			throw err
		}
	}

	return attempt()
}

// Sign in with magic link (sends email)
export async function signInWithMagicLink(email: string) {
	const client = getSupabaseBrowserClient()
	const { data, error } = await client.auth.signInWithOtp({
		email,
		options: {
			emailRedirectTo: `${window.location.origin}/auth/callback`
		}
	})

	if (error) {
		throw error
	}

	return data
}

// Sign out
export async function signOut() {
	const client = getSupabaseBrowserClient()
	const { error } = await client.auth.signOut()

	if (error) {
		throw error
	}
}

// Get current session
export async function getSession(): Promise<Session | null> {
	return withConnectionRetry(async (client) => {
		const {
			data: { session },
			error
		} = await client.auth.getSession()

		if (error) {
			throw error
		}

		return session
	})
}

// Fetch user profile from database
export async function fetchProfile(userId: string): Promise<Profile | null> {
	return withConnectionRetry(async (client) => {
		const { data, error } = await client
			.from('profiles')
			.select('*')
			.eq('id', userId)
			.single()

		if (error) {
			console.error('Error fetching profile:', error)
			return null
		}

		return data as Profile
	})
}

// Exchange auth code for session (for magic link callback)
export async function exchangeCodeForSession(code: string) {
	const client = getSupabaseBrowserClient()
	const { data, error } = await client.auth.exchangeCodeForSession(code)

	if (error) {
		throw error
	}

	return data
}

// Update display name in profiles table
export async function updateDisplayName(name: string): Promise<void> {
	const client = getSupabaseBrowserClient()

	const {
		data: { user }
	} = await client.auth.getUser()
	if (!user) {
		throw new Error('Must be logged in to update profile')
	}

	const { error } = await client
		.from('profiles')
		.update({ display_name: name, updated_at: new Date().toISOString() })
		.eq('id', user.id)

	if (error) {
		throw error
	}
}
