import { sequence, type Handle } from '@sveltejs/kit/hooks';
import { dev } from '$app/env';
import { Effect } from 'effect';
import { getTextDirection } from '#lib/paraglide/runtime.js';
import { paraglideMiddleware } from '#lib/paraglide/server.js';
import { requestChatTiming } from "#features/chat/lib/timing.ts";
import { getSessionUserEffect } from '#features/auth/api/session.server.ts';
import { useD1Binding } from '#shared/lib/db/d1-binding.server.ts';
import { useCloudflareBindings } from '#shared/lib/db/search-bindings.server.ts';
import { readOnlyResponse } from '#shared/lib/db/read-only.ts';

const CANONICAL_HOST = 'baeventos.com';

export const handleCanonicalOrigin: Handle = ({ event, resolve }) => {
	if (dev) return resolve(event);
	// Only the staging Worker sets CANONICAL_HOST (its workers.dev host); production keeps baeventos.com.
	const host = (event.platform as { env?: { CANONICAL_HOST?: string } } | undefined)?.env?.CANONICAL_HOST || CANONICAL_HOST;
	if (event.url.protocol === 'https:' && event.url.hostname === host) return resolve(event);
	const destination = new URL(event.url);
	destination.protocol = 'https:';
	destination.hostname = host;
	destination.port = '';
	// 308 keeps the method and body of non-GET requests across the redirect.
	const { method } = event.request;
	return Response.redirect(destination, method === 'GET' || method === 'HEAD' ? 301 : 308);
};

// (a) Session handle — load the authenticated user and their profile (Supabase Auth, or Better Auth on a Worker
// that binds D1) and expose them via `event.locals`.
const handleSupabase: Handle = async ({ event, resolve }) => {
  // These public media/feed endpoints never read account data or refresh a session.
  if (event.url.pathname === '/api/events/happening-soon' || event.url.pathname.startsWith('/api/event-artwork/')) {
    event.locals.user = null;
    event.locals.profile = null;
    event.locals.isAdmin = false;
    return resolve(event);
  }
	const timing = requestChatTiming(event);
	timing.mark("request_entry");
	const session = await Effect.runPromise(getSessionUserEffect(event));
	timing.mark("session_ready");
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

// (d) Cloudflare backend — search, chat, guests, feedback, and the rate limiter use D1 (and search Vectorize) when the
// Worker binds them (the staging Worker), Supabase otherwise.
const handleCloudflareBackend: Handle = ({ event, resolve }) => {
	const env = (event.platform as { env?: unknown } | undefined)?.env;
	useCloudflareBindings(env);
	useD1Binding(env);
	return resolve(event);
};

// (e) Cutover freeze — with DB_READ_ONLY=1 writes answer 503, except sign-in and guest chat (read-only.ts). After the
// session handle, because guest chat is allowed and a signed-in turn isn't.
export const handleReadOnly: Handle = ({ event, resolve }) => {
	const env = (event.platform as { env?: unknown } | undefined)?.env;
	return readOnlyResponse(env, event.request.method, event.url.pathname, !!event.locals.user) ?? resolve(event);
};

export const handle = sequence(handleCanonicalOrigin, handleCloudflareBackend, handleSupabase, handleReadOnly, handleLocaleSync, handleParaglide);
