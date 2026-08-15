import { createContext } from 'svelte'
import { browser } from '$app/env'
import type { User } from '@supabase/supabase-js'
import type { Profile } from '#shared/lib/types.ts'
import { getSupabaseBrowserClient, fetchProfile } from '#features/auth/api/client.ts'

export interface AuthContextValue {
	user: User | null
	profile: Profile | null
	isAdmin: boolean
	loading: boolean
}

/**
 * Single shared auth state for the app. `user`/`profile`/`loading` are reactive
 * `$state` fields; `isAdmin` is derived from the profile role.
 */
export class AuthState implements AuthContextValue {
	user = $state<User | null>(null)
	profile = $state<Profile | null>(null)
	loading = $state(true)

	get isAdmin(): boolean {
		return this.profile?.role === 'admin'
	}
}

const authState = new AuthState()

let initialized = false

const [get, set] = createContext<AuthContextValue>()

/**
 * Initialise the shared auth state from SSR data and subscribe to browser auth
 * changes. Called once by the root layout (`src/routes/+layout.svelte`).
 *
 * The legacy AuthProvider relied on React Query refetch + window focus; here we
 * mirror it with the Supabase `onAuthStateChange` listener instead of polling.
 */
export function initAuthContext(
	initial?: { user?: User | null; profile?: Profile | null } | null
): AuthContextValue {
	// Seed from this render's data on every call. On the server the module is
	// shared across requests, so seeding must NOT be gated by `initialized` —
	// otherwise a later request renders the previous request's session, and the
	// `set()` below is skipped, which makes `get()` throw `missing_context`.
	authState.user = initial?.user ?? null
	authState.profile = initial?.profile ?? null
	authState.loading = false

	// Subscribe to browser auth changes exactly once per client app lifetime.
	if (browser && !initialized) {
		initialized = true

		const client = getSupabaseBrowserClient()
		client.auth.onAuthStateChange((_event, session) => {
			authState.user = session?.user ?? null
			if (session?.user) {
				void fetchProfile(session.user.id).then((next) => {
					authState.profile = next
				})
			} else {
				authState.profile = null
			}
		})
	}

	// Context must be (re)established for the current component tree on every
	// render — Svelte contexts don't survive across SSR renders, and `get()`
	// below throws `missing_context` if `set()` hasn't run for this render.
	set(authState)

	return get()
}

/**
 * Access the auth context. Must be called during component initialisation, in a
 * component that is a descendant of the root layout (which calls
 * `initAuthContext`). Preserves the legacy `useAuthContext()` call-site shape.
 */
export function useAuthContext(): AuthContextValue {
	return get()
}

/** Module-level state access for mutation helpers (profile-mutations) and future cards. */
export function getAuthState(): AuthState {
	return authState
}
