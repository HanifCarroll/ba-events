import { createBrowserClient as createSupabaseBrowserClient } from '@supabase/ssr'
import type { SupabaseClient, Session } from '@supabase/supabase-js'
import { browser, dev } from '$app/env'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$app/env/public'
import { getLocale } from '#paraglide/runtime.js'
import type { Profile } from '#shared/lib/types.ts'
import { SESSION_CHANGED_EVENT } from '#features/auth/hooks/better-auth-session-sync.ts'
import { getProfile, signOut as signOutRemote, updateDisplayName as updateDisplayNameRemote } from './auth.remote.ts'

// Browser-side Supabase client for auth
// Note: These are public keys, safe to expose to browser

// Which sign-in runs comes from the root layout's data (`authBackend`): Supabase Auth in production until the cutover,
// Better Auth (`/api/auth/*`) on a Worker that binds D1. Each function below keeps its Supabase code unchanged and
// takes a separate branch only for Better Auth, where profile reads and writes go through the server.
export type AuthBackend = 'supabase' | 'better-auth'

let backend: AuthBackend = 'supabase'
export function setAuthBackend(value: AuthBackend) { backend = value }
export const usesBetterAuth = () => backend === 'better-auth'

/** POST to a Better Auth endpoint; throws its error message. */
async function betterAuth<T>(path: string, body: unknown): Promise<T> {
	const response = await fetch(`/api/auth${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
	const data = await response.json().catch(() => null) as (T & { message?: string }) | null
	if (!response.ok) throw new Error(data?.message || `Sign-in failed (${response.status})`)
	return data as T
}

// Where Better Auth sends the browser: home on success, the callback page (which shows `?error=`) on failure.
const callbacks = { callbackURL: '/', errorCallbackURL: '/auth/callback' }

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
	if (usesBetterAuth()) {
		return betterAuth('/sign-in/magic-link', { email: email.trim().toLowerCase(), ...callbacks, metadata: { locale: getLocale() } })
	}
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

export async function signInWithGoogle() {
	if (usesBetterAuth()) {
		const { url } = await betterAuth<{ url: string }>('/sign-in/social', { provider: 'google', ...callbacks })
		window.location.href = url
		return
	}
	const client = getSupabaseBrowserClient()
	const { data, error } = await client.auth.signInWithOAuth({
		provider: 'google',
		options: {
			redirectTo: `${window.location.origin}/auth/callback`
		}
	})

	if (error) {
		throw error
	}

	return data
}

// Sign out
export async function signOut() {
	if (usesBetterAuth()) {
		await signOutRemote()
		// The auth state re-reads the session, which clears the user, profile and user-owned views in every caller.
		window.dispatchEvent(new CustomEvent(SESSION_CHANGED_EVENT))
		return
	}
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
	if (usesBetterAuth()) return getProfile({ userId })
	return withConnectionRetry(async (client) => {
		const { data, error } = await client
			.from('profiles')
			.select('*')
			.eq('id', userId)
			.maybeSingle()

		if (error) {
			console.error('Error fetching profile:', error)
			throw error
		}

		return data as Profile | null
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
export async function updateDisplayName(name: string, expectedUserId?: string): Promise<void> {
	if (usesBetterAuth()) {
		if (!expectedUserId) throw new Error('Must be logged in to update profile')
		await updateDisplayNameRemote({ displayName: name, expectedUserId })
		return
	}
	const client = getSupabaseBrowserClient()

	const {
		data: { user }
	} = await client.auth.getUser()
	if (!user) {
		throw new Error('Must be logged in to update profile')
	}
	if (expectedUserId && user.id !== expectedUserId) {
		throw new Error('Account changed during profile update')
	}

	const { error } = await client
		.from('profiles')
		.update({ display_name: name, updated_at: new Date().toISOString() })
		.eq('id', user.id)

	if (error) {
		throw error
	}
}
