import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import netlify from '@netlify/vite-plugin-tanstack-start'
import { paraglideVitePlugin } from '@inlang/paraglide-js'

const config = defineConfig(({ isSsrBuild }) => ({
  resolve: {
    alias: [
      // Polyfill/stub Node.js modules for browser compatibility
      // Fixes TanStack Router SSR code being bundled in client build
      // Order matters: more specific paths first, use regex for exact matching
      { find: /^node:stream\/web$/, replacement: 'web-streams-polyfill' },
      { find: /^node:stream$/, replacement: 'stream-browserify' },
      // Stub async_hooks only for client build - server needs the real module
      ...(!isSsrBuild ? [{ find: /^node:async_hooks$/, replacement: new URL('./src/lib/stubs/async-hooks.ts', import.meta.url).pathname }] : []),
    ],
  },
  // Prevent TanStack Start packages from being externalized to ensure shared AsyncLocalStorage context
  ssr: {
    noExternal: [
      '@tanstack/react-start',
      '@tanstack/start',
      '@tanstack/start-client',
      '@tanstack/start-server',
      '@tanstack/start-server-core',
      '@tanstack/start-server-functions-client',
      '@tanstack/start-server-functions-fetcher',
      '@tanstack/start-server-functions-handler',
      '@tanstack/start-server-functions-server',
      '@tanstack/react-start-client',
      '@tanstack/react-start-server',
      '@tanstack/start-config',
      '@tanstack/start-plugin-core',
      '@tanstack/react-start-plugin',
      '@tanstack/start-router-manifest',
      '@tanstack/start-storage-context',
    ],
  },
  plugins: [
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
    tanstackStart(),
    viteReact(),
    netlify(),
  ],
}))

export default config
