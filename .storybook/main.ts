import { fileURLToPath } from 'node:url';
import type { StorybookConfig } from '@storybook/sveltekit';
import { mergeConfig } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const mock = (name: string) => fileURLToPath(new URL(`./mocks/${name}`, import.meta.url));

const config: StorybookConfig = {
	stories: ['../src/features/{chat,events}/components/*.stories.ts'],
	staticDirs: [{ from: './public', to: '/fixtures' }],
	addons: ['@storybook/addon-docs', '@storybook/addon-a11y', '@storybook/addon-vitest'],
	framework: {
		name: '@storybook/sveltekit',
		options: { builder: { viteConfigPath: '.storybook/vite.config.ts' } }
	},
	core: { disableTelemetry: true },
	viteFinal: (config) => mergeConfig(config, {
		resolve: {
			// Exact aliases stay inside Storybook; production imports are unchanged.
			alias: [
				{ find: '$app/env', replacement: mock('app-env.ts') },
				...[
					['src/features/auth/hooks/auth-context.svelte.ts', '#features/auth/hooks/auth-context.svelte.ts', 'auth.svelte.ts'],
					['src/features/chat/lib/saved.ts', '#features/chat/lib/saved.ts', 'saved.ts'],
					['src/shared/lib/analytics.ts', '#shared/lib/analytics.ts', 'analytics.ts'],
					['src/features/chat/lib/speech-recognition.ts', '#features/chat/lib/speech-recognition.ts', 'speech.ts']
				].flatMap(([path, specifier, replacement]) => [
					{ find: specifier, replacement: mock(replacement) },
					{ find: `${root}${path}`, replacement: mock(replacement) }
				])
			]
		}
	})
};

export default config;
