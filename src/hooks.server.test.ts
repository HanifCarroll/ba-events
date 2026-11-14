import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/env', () => ({ dev: false }));

import { handleCanonicalOrigin } from './hooks.server';

const eventFor = (url: string, method = 'GET') => ({ url: new URL(url), request: new Request(url, { method }) });

describe('canonical origin', () => {
	it('serves HTTPS apex requests without redirecting', async () => {
		const event = eventFor('https://salidasba.com/path?q=1');
		const rendered = new Response('Public app');
		const resolve = vi.fn().mockResolvedValue(rendered);
		expect(await handleCanonicalOrigin({ event, resolve } as never)).toBe(rendered);
		expect(resolve).toHaveBeenCalledWith(event);
	});

	it('permanently redirects HTTP, www, and old-domain GET and HEAD requests to the HTTPS apex', async () => {
		for (const url of [
			'http://salidasba.com/path?q=1',
			'https://www.salidasba.com/path?q=1',
			'https://baeventos.com/path?q=1',
			'https://www.baeventos.com/path?q=1',
		]) {
			for (const method of ['GET', 'HEAD']) {
				const resolve = vi.fn();
				const response = await handleCanonicalOrigin({ event: eventFor(url, method), resolve } as never);
				expect(response.status).toBe(301);
				expect(response.headers.get('location')).toBe('https://salidasba.com/path?q=1');
				expect(resolve).not.toHaveBeenCalled();
			}
		}
	});

	it('uses 308 for other methods so request bodies survive', async () => {
		const resolve = vi.fn();
		const response = await handleCanonicalOrigin({ event: eventFor('https://baeventos.com/api/feedback?x=1', 'POST'), resolve } as never);
		expect(response.status).toBe(308);
		expect(response.headers.get('location')).toBe('https://salidasba.com/api/feedback?x=1');
		expect(resolve).not.toHaveBeenCalled();
	});
});
