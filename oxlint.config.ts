import { recommended } from '@effect/tsgo/oxlint-presets';

export default {
	...recommended,
	// Adopt the Effect preset without turning on Oxlint's unrelated default rules.
	categories: { correctness: 'off' },
	ignorePatterns: ['src/lib/paraglide/**', '**/*.d.ts', '**/*.{js,jsx,mjs,cjs}'],
	rules: { ...recommended.rules },
};
