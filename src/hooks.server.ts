import { sequence, type Handle } from '@sveltejs/kit/hooks';
import { dev } from '$app/env';
import { Effect } from 'effect';
import { cookieMaxAge, cookieName, getTextDirection, isLocale } from '#lib/paraglide/runtime.js';
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

// Load the authenticated user and profile once for the request.
const handleSession: Handle = async ({ event, resolve }) => {
  // Public sitemap, media, and feed endpoints never read account data or refresh a session.
  const { pathname } = event.url;
  if (event.route.id === '/sitemap.xml' || pathname === '/api/events/happening-soon' || pathname.startsWith('/api/event-artwork/')) {
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

// Paraglide reads the locale in both the server request and document.cookie.
export const handleLocaleSync: Handle = ({ event, resolve }) => {
	if (event.route.id === '/sitemap.xml') return resolve(event);
	const previous = event.cookies.get(cookieName);
	const locale = event.locals.profile?.locale ?? (isLocale(previous) ? previous : undefined);
	if (!locale) return resolve(event);

	// The request doesn't say whether a legacy cookie was HttpOnly. Reissue it on document loads.
	if (locale !== previous || event.request.headers.get('accept')?.includes('text/html')) {
		event.cookies.set(cookieName, locale, { path: '/', maxAge: cookieMaxAge, httpOnly: false });
	}
	if (locale === previous) return resolve(event);

	const headers = new Headers(event.request.headers);
	const otherCookies = (headers.get('cookie') ?? '').split(';').map((cookie) => cookie.trim())
		.filter((cookie) => cookie && !cookie.startsWith(`${cookieName}=`));
	headers.set('cookie', [`${cookieName}=${locale}`, ...otherCookies].join('; '));
	return resolve({ ...event, request: new Request(event.request, { headers }) });
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
// Workers register the bindings used by shared repositories.
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
	// The request URL, not event.url: SvelteKit rewrites event.url to the calling page for remote commands.
	const { pathname } = new URL(event.request.url);
	return readOnlyResponse(env, event.request.method, pathname, !!event.locals.user) ?? resolve(event);
};

export const handle = sequence(handleCanonicalOrigin, handleCloudflareBackend, handleSession, handleReadOnly, handleLocaleSync, handleParaglide);
