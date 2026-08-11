import { defineConfig, type Plugin } from 'vite'
import { generateSW } from 'workbox-build'
import { join, resolve } from 'node:path'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import netlify from '@netlify/vite-plugin-tanstack-start'
import { paraglideVitePlugin } from '@inlang/paraglide-js'

// PWA service worker generation.
//
// vite-plugin-pwa (and its fork Serwist) do not run their build steps under
// TanStack Start's multi-environment build (TanStack/router#4988, still open).
// Instead we generate the SW directly with workbox-build once the client
// environment has finished writing dist/client (the Netlify publish dir).
const pwaWorkbox = (): Plugin => ({
  name: 'pwa-workbox',
  applyToEnvironment(env) {
    return env.name === 'client'
  },
  async closeBundle() {
    const distClient = resolve('dist/client')
    const { count, size, warnings } = await generateSW({
      globDirectory: distClient,
      // No static index.html exists in this SSR app, so HTML is handled by the
      // NetworkFirst navigate route below instead of a precache fallback.
      globPatterns: ['**/*.{js,css,svg,png,ico,json,woff2}'],
      swDest: join(distClient, 'sw.js'),
      skipWaiting: true,
      clientsClaim: true,
      cleanupOutdatedCaches: true,
      runtimeCaching: [
        {
          // Cache server-rendered HTML for offline revisits (network-first so
          // fresh SSR output wins when online).
          urlPattern: ({ request }) => request.mode === 'navigate',
          handler: 'NetworkFirst',
          options: {
            cacheName: 'pages',
            networkTimeoutSeconds: 3,
            expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 30 },
            cacheableResponse: { statuses: [200] },
          },
        },
        {
          // Google Fonts stylesheet + font files (cache-first is safe: URLs are
          // versioned by Google).
          urlPattern: ({ url }) =>
            url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
          handler: 'StaleWhileRevalidate',
          options: {
            cacheName: 'google-fonts',
            expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
          },
        },
      ],
    })

    for (const warning of warnings) {
      console.warn(`[pwa] ${warning}`)
    }
    console.log(`[pwa] generated sw.js with ${count} precached files (${(size / 1024).toFixed(1)} KiB)`)
  },
})

const clientNodePolyfills = (): Plugin => ({
  name: 'client-node-polyfills',
  enforce: 'pre',
  async resolveId(id, importer, options) {
    if (options?.ssr) return null

    if (id === 'node:async_hooks') {
      return new URL('./src/lib/stubs/async-hooks.ts', import.meta.url).pathname
    }
    if (id === 'node:stream') {
      const resolved = await this.resolve('stream-browserify', importer, { skipSelf: true })
      return resolved?.id ?? null
    }
    if (id === 'node:stream/web') {
      const resolved = await this.resolve('web-streams-polyfill', importer, { skipSelf: true })
      return resolved?.id ?? null
    }

    return null
  },
})

const config = defineConfig(() => ({
  plugins: [
    clientNodePolyfills(),
    pwaWorkbox(),
    paraglideVitePlugin({
      project: './project.inlang',
      outdir: './src/paraglide',
      strategy: ['cookie', 'preferredLanguage', 'baseLocale'],
    }),
    devtools(),
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tailwindcss(),
    tanstackStart({
      // Workaround for TanStack/router#7614 (open): on Vite 8 the SSR dev
      // middleware is silently skipped by a faulty environment check
      // ("dispatchFetch" in serverEnv). Forcing installation bypasses it;
      // the instanceof check that follows passes on single-Vite installs.
      // Remove once the upstream fix ships.
      vite: {
        installDevServerMiddleware: true,
      },
    }),
    viteReact(),
    netlify(),
  ],
}))

export default config
