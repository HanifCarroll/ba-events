/**
 * Guest Lifecycle Retention
 *
 * Bounds growth of the `guest_request_lifecycle` debug table. Runs daily and
 * deletes rows older than RETENTION_DAYS. A row stuck in `started` is a
 * diagnostic signal only for a short window; after that it is noise and is
 * purged with everything else.
 */
import { schedules } from '@trigger.dev/sdk/v3'
import { createServiceRoleClient } from '../utils/db-client.ts'

const RETENTION_DAYS = 30

export const guestLifecycleRetention = schedules.task({
  id: 'guest-lifecycle-retention',
  cron: {
    pattern: '0 7 * * *',
    timezone: 'America/Buenos_Aires',
  },
  run: async () => {
    const client = createServiceRoleClient()
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
  },
})
