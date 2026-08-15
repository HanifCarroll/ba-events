import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { exchangeCode } from '#features/auth/api/server.server.ts';

export const load: PageServerLoad = async (event) => {
	const url = event.url;

	// Check for error params (Supabase redirects back with these on failure).
	const error = url.searchParams.get('error');
	const errorDescription = url.searchParams.get('error_description');

	if (error) {
		return { error: errorDescription || error };
	}

	// PKCE code exchange (the `?code=` magic-link flow) is server-visible and
	// can run here, before the page renders. The implicit `#token_hash` flow is
	// client-only (URL fragments never reach the server) and is handled by the
	// page in `onMount`.
	const code = url.searchParams.get('code');
	const tokenHash = url.searchParams.get('token_hash');
	const type = url.searchParams.get('type');

	if (!code && !tokenHash) {
		return {};
	}

	try {
		await exchangeCode(event, {
			code: code ?? undefined,
			tokenHash: tokenHash ?? undefined,
			type: type ?? undefined
		});
	} catch (err) {
		console.error('Auth callback error:', err);
		return { error: err instanceof Error ? err.message : 'Authentication failed' };
	}

	throw redirect(303, '/');
};
