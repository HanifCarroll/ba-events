import { getLocale } from '#paraglide/runtime.js'
import type { Profile } from '#shared/lib/types.ts'
import { SESSION_CHANGED_EVENT } from '#features/auth/hooks/better-auth-session-sync.ts'
import { getProfile, signOut as signOutRemote, updateDisplayName as updateDisplayNameRemote } from './auth.remote.ts'

/** POST to a Better Auth endpoint; throws its error message. */
async function betterAuth<T>(path: string, body: unknown): Promise<T> {
	const response = await fetch(`/api/auth${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
	const data = await response.json().catch(() => null) as (T & { message?: string }) | null
	if (!response.ok) throw new Error(data?.message || `Sign-in failed (${response.status})`)
	return data as T
}

// Where Better Auth sends the browser: home on success, the callback page (which shows `?error=`) on failure.
const callbacks = { callbackURL: '/', errorCallbackURL: '/auth/callback' }

export function signInWithMagicLink(email: string) {
	return betterAuth('/sign-in/magic-link', { email: email.trim().toLowerCase(), ...callbacks, metadata: { locale: getLocale() } })
}

export async function signInWithGoogle() {
	const { url } = await betterAuth<{ url: string }>('/sign-in/social', { provider: 'google', ...callbacks })
	window.location.href = url
}

export async function signOut() {
	await signOutRemote()
	window.dispatchEvent(new CustomEvent(SESSION_CHANGED_EVENT))
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
	return getProfile({ userId })
}

export async function updateDisplayName(name: string, expectedUserId?: string): Promise<void> {
	if (!expectedUserId) throw new Error('Must be logged in to update profile')
	await updateDisplayNameRemote({ displayName: name, expectedUserId })
}
