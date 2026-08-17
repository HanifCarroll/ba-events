/**
 * Pure purge body for the guest lifecycle retention scheduled task, extracted
 * so it can be unit-tested with a fake client — without the Trigger.dev runtime
 * or the Supabase service-role client.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

const RETENTION_DAYS = 30

export async function purgeGuestLifecycleRetention(
	client: SupabaseClient
): Promise<{ purged: number }> {
	const cutoff = new Date(
		Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
	).toISOString()

	const { error, count } = await client
		.from('guest_request_lifecycle')
		.delete({ count: 'exact' })
		.lt('started_at', cutoff)

	if (error) {
		console.error('[guest-lifecycle-retention] Purge failed', error.message)
		throw new Error(`Guest lifecycle retention failed: ${error.message}`)
	}

	console.log(
		`[guest-lifecycle-retention] Purged ${count ?? 0} rows older than ${RETENTION_DAYS} days`
	)
	return { purged: count ?? 0 }
}
