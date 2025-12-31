import { defineConfig, type Plugin } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import netlify from '@netlify/vite-plugin-tanstack-start'
import { paraglideVitePlugin } from '@inlang/paraglide-js'

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
