import { defineConfig } from 'vitest/config';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import storybookViteConfig from './.storybook/vite.config.ts';

// Separate browser projects keep the existing Node and Bun suites credential-free.
export default defineConfig({
	test: {
		projects: ['es', 'en'].map((locale) => ({
			...storybookViteConfig,
			plugins: [
				storybookTest({ configDir: '.storybook', initialGlobals: { locale } }),
				...storybookViteConfig.plugins ?? []
			],
			test: {
				name: `storybook-${locale}`,
				browser: {
					enabled: true, headless: true,
					provider: playwright({ contextOptions: { timezoneId: 'America/Argentina/Buenos_Aires' } }),
					instances: [{ browser: 'chromium' }]
				}
			}
		}))
	}
});
