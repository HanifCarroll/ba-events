import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/env', () => ({ dev: false }));

import { handleCanonicalOrigin } from './hooks.server';

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
});
