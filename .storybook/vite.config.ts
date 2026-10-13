import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';

// Isolated components do not have SvelteKit 3's boot payload or Cloudflare runtime.
// Keep compiler settings aligned with the app's vite.config.ts.
export default defineConfig({
	resolve: { conditions: ['svelte', 'browser', 'module', 'development|production'] },
	plugins: [
		svelte({
			configFile: false,
			compilerOptions: {
				runes: ({ filename }) => filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
				experimental: { async: true }
			}
		}),
		tailwindcss()
	]
});
