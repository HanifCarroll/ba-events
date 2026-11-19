import type { PageServerLoad } from './$types';

// Better Auth verifies its links under /api/auth. This page is the failure destination.
export const load: PageServerLoad = ({ url }) => ({
	error: url.searchParams.get('error_description') || url.searchParams.get('error') ||
		'This sign-in link is no longer valid. Request a new one.',
});
