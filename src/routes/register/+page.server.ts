import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	// Legacy `beforeLoad` redirected /register → /login. Preserve any query
	// string so callers can pass it through unchanged.
	throw redirect(303, '/login' + (event.url.search || ''));
};
