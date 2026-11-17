/**
 * `check_rate_limit` on D1 (delivery PR 05): one fixed window per scope and hashed identifier, counted with a single
 * `INSERT … ON CONFLICT DO UPDATE … RETURNING`, so two concurrent requests can't both see the same count. Windows older
 * than 7 days are deleted in the same batch, as the Postgres function did.
 */
import type { D1Database } from '@cloudflare/workers-types'

export async function checkRateLimitD1(
	db: D1Database, scope: string, identifierHash: string, maxRequests: number, windowSeconds: number, now = Date.now(),
): Promise<{ success: boolean; remaining: number; reset: number; request_count: number }> {
	if (!scope.trim() || !identifierHash.trim() || maxRequests <= 0 || windowSeconds <= 0) throw new Error('Invalid rate limit')
	const windowMs = windowSeconds * 1000
	const windowStart = Math.floor(now / windowMs) * windowMs
	const iso = new Date(now).toISOString()
	const [counted] = await db.batch([
		db.prepare(`INSERT INTO rate_limit_windows AS rl (scope, identifier_hash, window_starts_at, request_count, created_at, updated_at)
				VALUES (?, ?, ?, 1, ?, ?)
				ON CONFLICT (scope, identifier_hash, window_starts_at) DO UPDATE SET request_count = rl.request_count + 1, updated_at = excluded.updated_at
				RETURNING request_count`)
			.bind(scope, identifierHash, new Date(windowStart).toISOString(), iso, iso),
		db.prepare('DELETE FROM rate_limit_windows WHERE updated_at < ?').bind(new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()),
	])
	const count = (counted.results?.[0] as { request_count?: unknown } | undefined)?.request_count
	if (typeof count !== 'number') throw new Error('Rate limit count unavailable')
	return { success: count <= maxRequests, remaining: Math.max(maxRequests - count, 0), reset: windowStart + windowMs, request_count: count }
}
