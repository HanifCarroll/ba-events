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
      // Polyfill/stub Node.js modules for browser compatibility - CLIENT BUILD ONLY
      // Server build uses real Node.js modules
      ...(!isSsrBuild ? [
        { find: /^node:stream\/web$/, replacement: 'web-streams-polyfill' },
        { find: /^node:stream$/, replacement: 'stream-browserify' },
        { find: /^node:async_hooks$/, replacement: new URL('./src/lib/stubs/async-hooks.ts', import.meta.url).pathname },
      ] : []),
    ],
  },
  // Prevent TanStack Start packages from being externalized to ensure shared AsyncLocalStorage context
  // Using specific patterns to avoid bundling incompatible packages
  ssr: {
    noExternal: [/^@tanstack\/.*start/, /^@tanstack\/router/],
    external: ['node:stream', 'node:stream/web', 'node:async_hooks'],
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
