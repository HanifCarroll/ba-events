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
import { purgeGuestLifecycleRetention } from './purge-guest-lifecycle-retention.ts'

export const guestLifecycleRetention = schedules.task({
  id: 'guest-lifecycle-retention',
  cron: {
    pattern: '0 7 * * *',
    timezone: 'America/Buenos_Aires',
  },
  run: async () => purgeGuestLifecycleRetention(createServiceRoleClient()),
})
