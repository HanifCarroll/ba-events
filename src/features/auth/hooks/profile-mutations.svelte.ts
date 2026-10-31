import {
	updateDisplayName as updateDisplayNameOnClient,
	signOut as signOutOnClient,
	fetchProfile
} from '#features/auth/api/client.ts'
import { deleteAccount as deleteAccountRemote } from '#features/auth/api/auth.remote.ts'
import { browser } from '$app/env'
import { goto } from '$app/navigation'
import { page } from '$app/state'
import { getAuthState } from './auth-context.svelte.ts'
import { createAccountDeletionController } from './account-deletion.ts'

/**
 * Update the current user's display name in Supabase, then re-fetch the profile
 * to reflect it in the shared auth state. Replaces the legacy React Query
 * `useUpdateDisplayName` mutation (profile-query invalidation is superseded by a
 * direct refetch + state update).
 */
export async function updateDisplayName(displayName: string): Promise<void> {
	const state = getAuthState()
	const userId = state.user?.id
	const revision = state.revision
	if (!userId) throw new Error('Must be logged in to update profile')
	await updateDisplayNameOnClient(displayName, userId)
	const refreshed = await fetchProfile(userId)
	if (refreshed) state.updateProfile(userId, refreshed, revision)
}

let accountDeletionController: ReturnType<typeof createAccountDeletionController> | undefined

/** Browser lifetime, per account. Page subscriptions never own deletion cleanup. */
export function getAccountDeletionController() {
	if (!browser) throw new Error('Account deletion is only available in the browser')
	return accountDeletionController ??= createAccountDeletionController({
		remove: (userId) => deleteAccountRemote({ userId }),
		signOut: signOutOnClient,
		currentUserId: () => getAuthState().user?.id ?? null,
		completed: () => {
			// The controller already fences a replacement account. Do not move a
			// user who left the profile page while the server request was running.
			if (page.route.id === '/profile') void goto('/')
		}
	})
}
