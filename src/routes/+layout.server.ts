import type { LayoutServerLoad } from './$types';

// Session data comes from `event.locals`, already populated by the auth handle
// in src/hooks.server.ts (avoid a second Supabase round-trip).
export const load: LayoutServerLoad = async (event) => {
	return {
		user: event.locals.user,
		profile: event.locals.profile,
		isAdmin: event.locals.isAdmin
	};
};
