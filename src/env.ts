import { defineEnvVars } from '@sveltejs/kit/env'

// Public, browser-safe environment variables (SvelteKit 3 explicit env API).
// Renamed from the legacy VITE_* prefixes per CONTRACTS.md §3.
export const variables = defineEnvVars({
	PUBLIC_SUPABASE_URL: { public: true },
	PUBLIC_SUPABASE_ANON_KEY: { public: true },
	PUBLIC_POSTHOG_KEY: { public: true },
	PUBLIC_POSTHOG_HOST: { public: true }
})
