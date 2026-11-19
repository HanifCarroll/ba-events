/** D1 binding detection and atomic write preconditions. */
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'

/** The D1 database bound as `DB` in a Worker env or SvelteKit `platform.env`, or null when there is none. */
export function boundD1Database(env: unknown): D1Database | null {
	const db = (env as { DB?: Partial<D1Database> } | null | undefined)?.DB
	return typeof db?.prepare === 'function' && typeof db.batch === 'function' ? (db as D1Database) : null
}

/**
 * A precondition for a `db.batch()`, which runs as one transaction. When `condition` (SQL, with `?` for `values`) is not
 * true when this statement runs, the batch aborts with `reason` as the error message and nothing in it is written.
 * `condition` is code, never user input; pass user values through `values`.
 */
export function batchAssert(db: D1Database, reason: string, condition: string, ...values: unknown[]): D1PreparedStatement {
	return db.prepare(`INSERT INTO _assert (reason, ok) SELECT ?, CASE WHEN (${condition}) THEN 1 ELSE 0 END`).bind(reason, ...values)
}

/**
 * Wraps an intake commit's statements so the protection trigger lets them change protected event facts: the
 * `write_context` row is set first and cleared last, inside the same transaction.
 */
export function intakeCommitBatch(db: D1Database, statements: D1PreparedStatement[]): D1PreparedStatement[] {
	return [
		db.prepare('INSERT INTO write_context (intake_commit) VALUES (1)'),
		...statements,
		db.prepare('DELETE FROM write_context'),
	]
}
