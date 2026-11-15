/** Cron (UTC) → Workflow binding. Keep in step with `triggers.crons` in wrangler.jobs.jsonc. */
export const CRON_WORKFLOWS = {
  '0 9 * * *': { binding: 'DAILY_SCRAPE', prefix: 'daily-scrape' }, // 06:00 Buenos Aires
  '0 10 * * *': { binding: 'GUEST_RETENTION', prefix: 'guest-retention' }, // 07:00
  '0 13 * * *': { binding: 'ENRICHMENT_CATCHUP', prefix: 'enrichment-catchup' }, // 10:00
} as const

/** One instance ID per firing, so a repeated delivery of the same firing cannot start a second run. */
export function cronInstance(cron: string, scheduledTimeMs: number) {
  const job = CRON_WORKFLOWS[cron as keyof typeof CRON_WORKFLOWS]
  if (!job) throw new Error(`No Workflow for cron ${cron}`)
  const scheduledTime = new Date(scheduledTimeMs).toISOString()
  return { binding: job.binding, id: `${job.prefix}-${scheduledTime.replace(/[^0-9]/g, '').slice(0, 12)}`, scheduledTime }
}
