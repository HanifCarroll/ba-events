import { requireAuth } from '#features/auth/api/session.server.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const session = await requireAuth(event, '/profile');

	return {
		user: session.user,
		profile: session.profile
	};
};
