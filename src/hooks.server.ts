import { sequence, type Handle } from '@sveltejs/kit/hooks';
import { getTextDirection } from '#lib/paraglide/runtime.js';
import { paraglideMiddleware } from '#lib/paraglide/server.js';
import { createSupabaseServerClient } from '#shared/lib/db/server-client.server.ts';
import type { Profile } from '#shared/lib/types.ts';

// (a) Supabase handle — create a per-request server client, load the
// authenticated user and their profile, and expose them via `event.locals`.
const handleSupabase: Handle = async ({ event, resolve }) => {
	const supabase = createSupabaseServerClient(event);

	const {
		data: { user },
		error
	} = await supabase.auth.getUser();

	if (error || !user) {
		event.locals.user = null;
		event.locals.profile = null;
		event.locals.isAdmin = false;
		return resolve(event);
	}

	event.locals.user = user;

	const { data: profile } = await supabase
		.from('profiles')
		.select('*')
		.eq('id', user.id)
		.single();

	const profileData = (profile as Profile | null) ?? null;
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

export const handle = sequence(handleSupabase, handleLocaleSync, handleParaglide);
