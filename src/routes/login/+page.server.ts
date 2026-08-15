import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getSessionUser } from '#features/auth/api/session.server.ts';

export const load: PageServerLoad = async (event) => {
	// Redirect to home if already logged in (legacy `beforeLoad` did the same).
	// Legacy redirected to '/' unconditionally; the card asks us to honour
	// `?redirect=` after login, so fall back to '/' when it is absent.
	const session = await getSessionUser(event);
	if (session) {
		throw redirect(303, event.url.searchParams.get('redirect') ?? '/');
	}

	return {};
};
