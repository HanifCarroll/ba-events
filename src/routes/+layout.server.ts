import type { LayoutServerLoad } from './$types';
import { betterAuthStatus } from '#features/auth/api/better-auth.server.ts';

// Session data comes from `event.locals`, already populated by the auth handle
// in src/hooks.server.ts (avoid a second Supabase round-trip).
export const load: LayoutServerLoad = async (event) => {
	return {
		user: event.locals.user,
		profile: event.locals.profile,
		isAdmin: event.locals.isAdmin,
		// Which sign-in the browser uses: Better Auth on a Worker that binds D1, Supabase otherwise.
		authBackend: betterAuthStatus(event) === 'supabase' ? 'supabase' as const : 'better-auth' as const
	};
};
