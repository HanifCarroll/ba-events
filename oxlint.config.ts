import { recommended } from '@effect/tsgo/oxlint-presets';

export default {
	...recommended,
	// Adopt the Effect preset without turning on Oxlint's unrelated default rules.
	categories: { correctness: 'off' },
	ignorePatterns: ['src/lib/paraglide/**', '**/*.d.ts', '**/*.{js,jsx,mjs,cjs}'],
	rules: { ...recommended.rules },
	overrides: [
		{
			files: [
				'src/features/chat/api/agent/search-context.ts',
				'src/features/chat/api/chat-d1.server.ts',
				'src/features/chat/api/messages.remote.ts',
				'src/features/chat/lib/delivery.ts',
				'src/features/import/core/catalog-store-d1.ts',
				'src/features/import/core/nominatim.ts',
				'src/features/import/intake/collection.ts',
				'src/features/import/intake/venue-address.ts',
				'src/features/telegram/client.ts',
				'src/jobs-worker/intake-api.ts',
				'src/routes/api/events/+server.ts',
				'src/shared/lib/db/search-d1.server.ts',
				'src/shared/lib/search/rerank.ts',
			],
			// Keep existing wire and storage decoders' accepted values and error messages unchanged.
			rules: { 'effecttsgo/schema-number': 'off' },
		},
	],
};
