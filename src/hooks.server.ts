import { sequence, type Handle } from '@sveltejs/kit/hooks';
import { Effect } from 'effect';
import { getTextDirection } from '#lib/paraglide/runtime.js';
import { paraglideMiddleware } from '#lib/paraglide/server.js';
import { getSessionUserEffect } from '#features/auth/api/session.server.ts';

export const handleCanonicalOrigin: Handle = ({ event, resolve }) => {
	if (event.url.protocol === 'https:' && event.url.hostname === 'baeventos.com') return resolve(event);
	const destination = new URL(event.url);
	destination.protocol = 'https:';
	destination.hostname = 'baeventos.com';
	return Response.redirect(destination, 301);
};

// (a) Supabase handle — create a per-request server client, load the
// authenticated user and their profile, and expose them via `event.locals`.
const handleSupabase: Handle = async ({ event, resolve }) => {
	const session = await Effect.runPromise(getSessionUserEffect(event));
	if (!session) {
		event.locals.user = null;
		event.locals.profile = null;
		event.locals.isAdmin = false;
		return resolve(event);
	}

	event.locals.user = session.user;

	const profileData = session.profile;
	event.locals.profile = profileData;
	event.locals.isAdmin = profileData?.role === 'admin';

	return resolve(event);
};

// (b) Locale sync — persist the user's saved locale to the paraglide cookie
// (port of the legacy __root.tsx beforeLoad locale-sync).
const handleLocaleSync: Handle = async ({ event, resolve }) => {
	const savedLocale = event.locals.profile?.locale;

	if (savedLocale && event.cookies.get('PARAGLIDE_LOCALE') !== savedLocale) {
		event.cookies.set('PARAGLIDE_LOCALE', savedLocale, {
			path: '/',
			maxAge: 34560000 // matches paraglide's cookieMaxAge (1 year)
		});
	}

	return resolve(event);
};

// (c) Paraglide handle — keep LAST so transformPageChunk sees the final locale.
const handleParaglide: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request, locale }) =>
		resolve(
			{ ...event, request },
			{
				transformPageChunk: ({ html }) =>
					html
						.replace('%paraglide.lang%', locale)
						.replace('%paraglide.dir%', getTextDirection(locale))
			}
		)
	);

export const handle = sequence(handleCanonicalOrigin, handleSupabase, handleLocaleSync, handleParaglide);
