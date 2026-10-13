import type { AuthContextValue } from '#features/auth/hooks/auth-context.svelte.ts';

export const auth = $state<AuthContextValue>({
	user: null, profile: null, isAdmin: false, loading: false
});

export const useAuthContext = (): AuthContextValue => auth;
