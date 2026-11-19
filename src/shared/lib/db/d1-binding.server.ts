/** Worker entry points register the isolate's D1 binding for shared repositories. */
import type { D1Database } from '@cloudflare/workers-types'
import { boundD1Database } from './d1.server.ts'

let database: D1Database | null = null

/** Records the env's `DB` binding, or clears it when the env has none. */
export function useD1Binding(env: unknown): void {
	database = boundD1Database(env)
}

export function boundD1(): D1Database | null {
	return database
}

export function requireD1(): D1Database {
	if (!database) throw new Error('Missing DB binding')
	return database
}
