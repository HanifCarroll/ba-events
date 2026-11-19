/**
 * Guest lifecycle retention. Bounds growth of the guest lifecycle and
 * transcript debug tables by deleting rows older than RETENTION_DAYS. Runs
 * daily from the jobs Worker; takes the client so tests can pass a fake.
 */
import type { D1Database } from '@cloudflare/workers-types'

const RETENTION_DAYS = 30

export async function purgeGuestLifecycleRetention(
	db: D1Database
): Promise<{ purged: number }> {
	const cutoff = new Date(
		Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
	).toISOString()

	const [lifecycle, transcripts] = await db.batch([
		db.prepare('DELETE FROM guest_request_lifecycle WHERE started_at < ?').bind(cutoff),
		db.prepare('DELETE FROM guest_chat_debug WHERE updated_at < ?').bind(cutoff),
	])
	const purged = lifecycle.meta.changes + transcripts.meta.changes
	console.log(`[guest-lifecycle-retention] Purged ${purged} rows older than ${RETENTION_DAYS} days`)
	return { purged }
}
