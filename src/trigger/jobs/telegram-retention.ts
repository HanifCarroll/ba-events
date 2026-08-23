import { schedules } from '@trigger.dev/sdk/v3'
import { createServiceRoleClient } from '../utils/db-client.ts'
import { purgeTelegramRetention } from './purge-telegram-retention.ts'

export const telegramRetention = schedules.task({
  id: 'telegram-retention',
  cron: {
    pattern: '30 7 * * *',
    timezone: 'America/Buenos_Aires',
  },
  run: async () => purgeTelegramRetention(createServiceRoleClient()),
})
