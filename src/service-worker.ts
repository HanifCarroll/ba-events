/**
 * Service worker (SvelteKit 3 native).
 *
 * Replaces the legacy workbox-build `generateSW` (vite `pwaWorkbox` plugin),
 * which precached client build assets (js/css/svg/png/ico/json/woff2) with
 * `skipWaiting` + `clientsClaim`, no navigation fallback, and a
 * StaleWhileRevalidate runtime cache for Google Fonts (1y, 20 entries).
 *
 * The legacy comment is preserved below: SSR navigation documents are NOT
 * cached because their language varies by locale cookie + Accept-Language,
 * and reusing one across locales breaks hydration.
 */
import { immutable, assets, prerendered } from '$app/manifest';
import { self } from '$app/service-worker';

const normalize = (path: string) => (path.startsWith('/') ? path : `/${path}`);

// Precache the immutable build files, static assets, and prerendered pages.
const PRECACHE = [
	...immutable.map(({ path }) => normalize(path)),
	...assets.map(({ path }) => normalize(path)),
	...prerendered.map(({ path }) => normalize(path))
];

const PRECACHE_PATHS = new Set(PRECACHE);

// Unique cache name per deployment so old precaches are cleaned up on activate.
// The immutable asset paths are content-hashed, so this fingerprint changes on
// every deploy — `$app/env` `version` is not used here because it resolves to
// `payload.version` (undefined) inside the service-worker build.
const CACHE = `ba-events-${hashString(PRECACHE.join('\n'))}`;

function hashString(input: string): string {
	let hash = 0;
	for (let i = 0; i < input.length; i++) {
		hash = (Math.imul(31, hash) + input.charCodeAt(i)) | 0;
	}
	return Math.abs(hash).toString(36);
}
const FONT_CACHE = 'google-fonts';
const FONT_MAX_ENTRIES = 20;
const FONT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year (workbox expiration)

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			await cache.addAll(PRECACHE);
		})()
	);
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE && key !== FONT_CACHE) await caches.delete(key);
			}
		})()
	);
	self.clients.claim();
});

self.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);

	// Google Fonts stylesheet + font files (cache-first is safe: URLs are
	// versioned by Google). StaleWhileRevalidate, 1y, 20 entries — mirrors the
	// legacy workbox runtimeCaching config.
	if (url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') {
		event.respondWith(staleWhileRevalidate(request));
		return;
	}

	// Serve precached build/static assets cache-first (workbox precache
	// behavior). These are content-hashed and safe to reuse across deploys.
	if (PRECACHE_PATHS.has(url.pathname)) {
		event.respondWith(
			(async () => {
				const cache = await caches.open(CACHE);
				const cached = await cache.match(request);
				if (cached) return cached;
				return fetch(request);
			})()
		);
		return;
	}

	// Do not cache SSR navigation documents. Their language varies by locale
	// cookie and Accept-Language; reusing one across locales breaks hydration.
	// (No navigate fallback — everything else goes through the network.)
});

async function staleWhileRevalidate(request: Request): Promise<Response> {
	const cache = await caches.open(FONT_CACHE);
	const cached = await cache.match(request);

	if (cached) {
		const date = cached.headers.get('Date');
		const ageSeconds = date ? (Date.now() - new Date(date).getTime()) / 1000 : 0;
		if (ageSeconds > FONT_MAX_AGE_SECONDS) {
			await cache.delete(request);
		} else {
			// Revalidate in the background (workbox StaleWhileRevalidate).
			fetch(request)
				.then(async (response) => {
					if (response && response.status === 200) {
						await cache.put(request, response.clone());
						await trimFontCache(cache);
					}
				})
				.catch(() => {});
			return cached;
		}
	}

	try {
		const response = await fetch(request);
		if (response && response.status === 200) {
			await cache.put(request, response.clone());
			await trimFontCache(cache);
		}
		return response;
	} catch {
		if (cached) return cached;
		return Response.error();
	}
}

async function trimFontCache(cache: Cache): Promise<void> {
	const keys = await cache.keys();
	if (keys.length <= FONT_MAX_ENTRIES) return;
	// cache.keys() returns entries in insertion order; drop the oldest first.
	const excess = keys.length - FONT_MAX_ENTRIES;
	await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
}
