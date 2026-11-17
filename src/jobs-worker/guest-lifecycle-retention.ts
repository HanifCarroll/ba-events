/**
 * Guest lifecycle retention. Bounds growth of the guest lifecycle and
 * transcript debug tables by deleting rows older than RETENTION_DAYS. Runs
 * daily from the jobs Worker; takes the client so tests can pass a fake.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { D1Database } from '@cloudflare/workers-types'

const RETENTION_DAYS = 30

export async function purgeGuestLifecycleRetention(
	client: SupabaseClient | { d1: D1Database }
): Promise<{ purged: number }> {
	const cutoff = new Date(
		Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
	).toISOString()

	if ('d1' in client) {
		const [lifecycle, transcripts] = await client.d1.batch([
			client.d1.prepare('DELETE FROM guest_request_lifecycle WHERE started_at < ?').bind(cutoff),
			client.d1.prepare('DELETE FROM guest_chat_debug WHERE updated_at < ?').bind(cutoff),
		])
		const purged = lifecycle.meta.changes + transcripts.meta.changes
		console.log(`[guest-lifecycle-retention] Purged ${purged} rows older than ${RETENTION_DAYS} days`)
		return { purged }
	}

	const { error: lifecycleError, count: lifecycleCount } = await client
		.from('guest_request_lifecycle')
		.delete({ count: 'exact' })
		.lt('started_at', cutoff)

	if (lifecycleError) {
		console.error('[guest-lifecycle-retention] Purge failed', lifecycleError.message)
		throw new Error(`Guest lifecycle retention failed: ${lifecycleError.message}`)
	}

	const { error: transcriptError, count: transcriptCount } = await client
		.from('guest_chat_debug')
		.delete({ count: 'exact' })
		.lt('updated_at', cutoff)

	if (transcriptError) {
		console.error('[guest-lifecycle-retention] Purge failed', transcriptError.message)
		throw new Error(`Guest lifecycle retention failed: ${transcriptError.message}`)
	}

	const purged = (lifecycleCount ?? 0) + (transcriptCount ?? 0)

	console.log(
		`[guest-lifecycle-retention] Purged ${purged} rows older than ${RETENTION_DAYS} days`
	)
	return { purged }
}
