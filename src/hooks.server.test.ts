import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/env', () => ({ dev: false }));

import { handleCanonicalOrigin, handleLocaleSync, handleReadOnly } from './hooks.server';

const eventFor = (url: string, method = 'GET') => ({ url: new URL(url), request: new Request(url, { method }) });

const redirectHosts = [
	'http://baeventos.com',
	'https://www.baeventos.com',
	'https://salidasba.com',
	'https://www.salidasba.com',
	'https://baeventos.app',
	'https://www.baeventos.app',
];

describe('canonical origin', () => {
	it('serves HTTPS apex requests without redirecting', async () => {
		const event = eventFor('https://baeventos.com/path?q=1');
		const rendered = new Response('Public app');
		const resolve = vi.fn().mockResolvedValue(rendered);
		expect(await handleCanonicalOrigin({ event, resolve } as never)).toBe(rendered);
		expect(resolve).toHaveBeenCalledWith(event);
	});

	it('permanently redirects HTTP, www, and redirect-domain GET and HEAD requests to the HTTPS apex', async () => {
		for (const origin of redirectHosts) {
			for (const method of ['GET', 'HEAD']) {
				const resolve = vi.fn();
				const response = await handleCanonicalOrigin({ event: eventFor(`${origin}/path?q=1`, method), resolve } as never);
				expect(response.status).toBe(301);
				expect(response.headers.get('location')).toBe('https://baeventos.com/path?q=1');
				expect(resolve).not.toHaveBeenCalled();
			}
		}
	});

	it('uses 308 for other methods so request bodies survive', async () => {
		for (const origin of redirectHosts) {
			const resolve = vi.fn();
			const response = await handleCanonicalOrigin({ event: eventFor(`${origin}/api/feedback?x=1`, 'POST'), resolve } as never);
			expect(response.status).toBe(308);
			expect(response.headers.get('location')).toBe('https://baeventos.com/api/feedback?x=1');
			expect(resolve).not.toHaveBeenCalled();
		}
	});

	it('uses the env CANONICAL_HOST when the Worker sets one (staging), and baeventos.com otherwise', async () => {
		const staging = 'baeventos-staging.example.workers.dev';
		const rendered = new Response('Staging app');
		const event = { ...eventFor(`https://${staging}/path`), platform: { env: { CANONICAL_HOST: staging } } };
		expect(await handleCanonicalOrigin({ event, resolve: vi.fn().mockResolvedValue(rendered) } as never)).toBe(rendered);
		const production = await handleCanonicalOrigin({ event: eventFor(`https://${staging}/path`), resolve: vi.fn() } as never);
		expect(production.headers.get('location')).toBe('https://baeventos.com/path');
	});
});

describe('locale preference synchronization', () => {
	it.each([null, { locale: 'es' }])('reissues a matching or legacy preference on HTML requests (profile %j)', async (profile) => {
		const url = 'https://baeventos.com/?f=gratis';
		const cookies = { get: () => 'es', set: vi.fn() };
		const event = { ...eventFor(url), request: new Request(url, { headers: { accept: 'text/html' } }), cookies, locals: { profile } };
		const resolve = vi.fn(() => new Response());
		await handleLocaleSync({ event, resolve } as never);
		expect(cookies.set).toHaveBeenCalledWith('PARAGLIDE_LOCALE', 'es', { path: '/', maxAge: 34560000, httpOnly: false });
		expect(resolve).toHaveBeenCalledWith(event);
	});

	it('forwards the saved locale on the same request without dropping the other cookies or the body', async () => {
		const url = 'https://baeventos.com/?f=gratis';
		const request = new Request(url, { method: 'POST', body: 'payload', headers: {
			cookie: 'other=first; PARAGLIDE_LOCALE=en; session=fixture%2Etoken', accept: 'text/html'
		} });
		const cookies = { get: () => 'en', set: vi.fn() };
		const event = { url: new URL(url), request, cookies, locals: { profile: { locale: 'es' } } };
		const resolve = async ({ request: synced }: typeof event) => {
			expect(synced.url).toBe(url);
			expect(synced.headers.get('cookie')).toBe('PARAGLIDE_LOCALE=es; other=first; session=fixture%2Etoken');
			expect(await synced.text()).toBe('payload');
			return new Response();
		};
		await handleLocaleSync({ event, resolve } as never);
		expect(cookies.set).toHaveBeenCalledWith('PARAGLIDE_LOCALE', 'es', expect.objectContaining({ httpOnly: false }));
	});
});

describe('DB_READ_ONLY freeze in the hook', () => {
	// SvelteKit sets event.url to the calling page (x-sveltekit-pathname) for remote commands; the request keeps the endpoint.
	const remote = (name: string, page: string, user: unknown = { id: 'u1' }) => ({
		request: new Request(`https://baeventos.com/_app/remote/abc123/${name}`, { method: 'POST', headers: { 'x-sveltekit-pathname': page } }),
		url: new URL(`https://baeventos.com${page}`),
		locals: { user },
		platform: { env: { DB_READ_ONLY: '1' } },
	});

	it('lets getProfile and signOut through from any page', async () => {
		for (const name of ['getProfile', 'signOut']) {
			for (const page of ['/', '/saved', '/profile']) {
				const rendered = new Response('ok');
				const response = await handleReadOnly({ event: remote(name, page), resolve: vi.fn().mockResolvedValue(rendered) } as never);
				expect(response, `${name} from ${page}`).toBe(rendered);
			}
		}
	});

	it('blocks mutation commands even when the page path names an exempt route', async () => {
		for (const page of ['/api/auth/sign-out', '/_app/remote/abc123/getProfile', '/api/chat']) {
			for (const name of ['addMessage', 'updateDisplayName', 'deleteAccount']) {
				const resolve = vi.fn();
				const response = await handleReadOnly({ event: remote(name, page), resolve } as never);
				expect(response.status, `${name} from ${page}`).toBe(503);
				expect(resolve).not.toHaveBeenCalled();
			}
		}
	});

	it('changes nothing when the freeze is off', async () => {
		const event = { ...remote('addMessage', '/'), platform: { env: {} } };
		const rendered = new Response('ok');
		expect(await handleReadOnly({ event, resolve: vi.fn().mockResolvedValue(rendered) } as never)).toBe(rendered);
	});
});
