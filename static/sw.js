// Unregister the pre-cutover TanStack Start service worker at /sw.js.
// Returning clients still have this URL registered; the SvelteKit worker lives
// at /service-worker.js. Drop the old controller so they pick up the new app.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys()
			await Promise.all(keys.map((key) => caches.delete(key)))
			await self.registration.unregister()
			const clients = await self.clients.matchAll({ type: 'window' })
			for (const client of clients) {
				client.navigate(client.url)
			}
		})()
	)
})
