import { isReadOnly } from '#shared/lib/db/read-only.ts'

/** Cron (UTC) → Workflow binding. Keep in step with `triggers.crons` in wrangler.jobs.jsonc. */
export const CRON_WORKFLOWS = {
  '0 9 * * *': { binding: 'DAILY_SCRAPE', prefix: 'daily-scrape' }, // 06:00 Buenos Aires
  '0 10 * * *': { binding: 'GUEST_RETENTION', prefix: 'guest-retention' }, // 07:00
  '0 13 * * *': { binding: 'ENRICHMENT_CATCHUP', prefix: 'enrichment-catchup' }, // 10:00
} as const

/**
 * Cron (UTC) → a short catalog task that runs in `scheduled()` itself, only on D1 (index.ts `runCatalogTask`). Keep in
 * step with `triggers.crons` too. 06:00 UTC is 03:00 Buenos Aires, clear of the cutover window and the 06:00 scrape.
 */
export const CRON_TASKS = {
  '0 * * * *': 'mark-past-events',
  '0 6 * * *': 'reconcile-vectors',
} as const

/** One instance ID per firing, so a repeated delivery of the same firing cannot start a second run. */
export function cronInstance(cron: string, scheduledTimeMs: number) {
  const job = CRON_WORKFLOWS[cron as keyof typeof CRON_WORKFLOWS]
  if (!job) throw new Error(`No Workflow for cron ${cron}`)
  const scheduledTime = new Date(scheduledTimeMs).toISOString()
  return { binding: job.binding, id: `${job.prefix}-${scheduledTime.replace(/[^0-9]/g, '').slice(0, 12)}`, scheduledTime }
}

type Bindings = Record<(typeof CRON_WORKFLOWS)[keyof typeof CRON_WORKFLOWS]['binding'], { create(options: { id: string; params?: unknown }): Promise<unknown> }>

/**
 * What `scheduled()` does for a firing: nothing while `DB_READ_ONLY` freezes writes (the cutover window), the catalog
 * task for a CRON_TASKS cron, or the firing's Workflow instance.
 */
export function dispatchCron<E extends Bindings>(controller: { cron: string; scheduledTime: number }, env: E,
  runTask: (task: (typeof CRON_TASKS)[keyof typeof CRON_TASKS], env: E) => Promise<unknown>): Promise<void> {
  if (isReadOnly(env)) return Promise.resolve()
  const task = CRON_TASKS[controller.cron as keyof typeof CRON_TASKS]
  return task ? runTask(task, env).then(() => undefined) : startScheduledWorkflow(controller, env)
}

/** Start the firing's instance. Only "already exists" (a repeated delivery) is ignored; other errors propagate. */
export async function startScheduledWorkflow(controller: { cron: string; scheduledTime: number }, env: Bindings): Promise<void> {
  const { binding, id, scheduledTime } = cronInstance(controller.cron, controller.scheduledTime)
  try {
    await env[binding].create({ id, params: { scheduledTime } })
  } catch (error) {
    if (!/already exists/i.test(String(error))) throw error
  }
}
