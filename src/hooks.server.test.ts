import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/env', () => ({ dev: false }));

import { handleCanonicalOrigin } from './hooks.server';

describe('canonical origin', () => {
	it('serves HTTPS apex requests without redirecting', async () => {
		const event = { url: new URL('https://baeventos.com/path?q=1') };
		const rendered = new Response('Public app');
		const resolve = vi.fn().mockResolvedValue(rendered);
		expect(await handleCanonicalOrigin({ event, resolve } as never)).toBe(rendered);
		expect(resolve).toHaveBeenCalledWith(event);
	});

	it('permanently redirects HTTP and www requests to HTTPS apex', async () => {
		for (const url of ['http://baeventos.com/path?q=1', 'https://www.baeventos.com/path?q=1']) {
			const resolve = vi.fn();
			const response = await handleCanonicalOrigin({ event: { url: new URL(url) }, resolve } as never);
			expect(response.status).toBe(301);
			expect(response.headers.get('location')).toBe('https://baeventos.com/path?q=1');
			expect(resolve).not.toHaveBeenCalled();
		}
	});
});
