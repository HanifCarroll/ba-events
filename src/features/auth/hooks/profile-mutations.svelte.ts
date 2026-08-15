import {
	updateDisplayName as updateDisplayNameOnClient,
	signOut as signOutOnClient,
	fetchProfile
} from '#features/auth/api/client.ts'
import { deleteAccount as deleteAccountRemote } from '#features/auth/api/auth.remote.ts'
import { getAuthState } from './auth-context.svelte.ts'

/**
 * Update the current user's display name in Supabase, then re-fetch the profile
 * to reflect it in the shared auth state. Replaces the legacy React Query
 * `useUpdateDisplayName` mutation (profile-query invalidation is superseded by a
 * direct refetch + state update).
 */
export async function updateDisplayName(displayName: string): Promise<void> {
	await updateDisplayNameOnClient(displayName)

	const state = getAuthState()
	const userId = state.user?.id
	if (userId) {
		const refreshed = await fetchProfile(userId)
		if (refreshed) {
			state.profile = refreshed
		}
	}
}

/**
 * Delete the current user's account (server-side), then sign out the browser
 * session. Replaces the legacy `useDeleteAccount` mutation. The auth-context
 * `onAuthStateChange` listener clears the shared state on the SIGNED_OUT event.
 */
export async function deleteAccount(userId: string): Promise<void> {
	await deleteAccountRemote({ userId })
	await signOutOnClient()
}
