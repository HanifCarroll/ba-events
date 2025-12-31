import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import netlify from '@netlify/vite-plugin-tanstack-start'
import { paraglideVitePlugin } from '@inlang/paraglide-js'

const config = defineConfig({
  resolve: {
    alias: [
      // Polyfill/stub Node.js modules for browser compatibility
      // Fixes TanStack Router SSR code being bundled in client build
      // Order matters: more specific paths first, use regex for exact matching
      { find: /^node:stream\/web$/, replacement: 'web-streams-polyfill' },
      { find: /^node:stream$/, replacement: 'stream-browserify' },
      // Stub async_hooks - it's server-only but leaks into client bundle analysis
      { find: /^node:async_hooks$/, replacement: new URL('./src/lib/stubs/async-hooks.ts', import.meta.url).pathname },
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
})

export default config
