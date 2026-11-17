/**
 * Which backend chat, guest diagnostics, Telegram, feedback, and the rate limiter use. Each Worker entry point
 * (SvelteKit hooks, the Telegram Worker, the jobs Workflow) passes its env here; when the env binds `DB` (the seam in
 * d1.server.ts) those paths run on D1, otherwise they stay on Supabase. Production binds `DB` only at the cutover.
 * Bindings belong to the isolate, not the request, so holding the binding in module state is safe.
 */
import type { D1Database } from '@cloudflare/workers-types'
import { boundD1Database } from './d1.server.ts'

let database: D1Database | null = null

/** Records the env's `DB` binding, or clears it when the env has none. */
export function useD1Binding(env: unknown): void {
	database = boundD1Database(env)
}

/** The bound D1 database, or null when this Worker uses Supabase. */
export function boundD1(): D1Database | null {
	return database
}
