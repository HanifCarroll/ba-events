import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/env', () => ({ dev: true }));

import { handleCanonicalOrigin } from './hooks.server';

describe('development origin', () => {
	it('serves development requests at their original origin', async () => {
		for (const url of ['http://localhost:3001/path?q=1', 'http://127.0.0.1:3001/path?q=1']) {
			const event = { url: new URL(url) };
			const rendered = new Response('Local app');
			const resolve = vi.fn().mockResolvedValue(rendered);
			const response = await handleCanonicalOrigin({ event, resolve } as never);
			expect(response.status).toBe(200);
			expect(response.headers.get('location')).toBeNull();
			expect(resolve).toHaveBeenCalledWith(event);
			expect(event.url.href).toBe(url);
		}
	});
});
