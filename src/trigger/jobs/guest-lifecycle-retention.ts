/**
 * Guest Lifecycle Retention
 *
 * Bounds growth of the guest lifecycle and transcript debug tables. Runs
 * daily and deletes rows older than RETENTION_DAYS.
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
