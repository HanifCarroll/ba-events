import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { CRON_TASKS, CRON_WORKFLOWS, cronInstance, dispatchCron, startScheduledWorkflow } from './schedule.ts'

describe('jobs schedule', () => {
  it('maps exactly the configured crons, at the old Buenos Aires times', () => {
    const config = readFileSync(new URL('../../wrangler.jobs.jsonc', import.meta.url), 'utf8')
    const crons = JSON.parse(config.match(/"crons":\s*(\[[^\]]*\])/)![1]) as string[]
    expect(crons.sort()).toEqual([...Object.keys(CRON_WORKFLOWS), ...Object.keys(CRON_TASKS)].sort())
    expect(config).not.toContain('"schedules"')
  })

  it('names one instance per firing and rejects unknown crons', () => {
    const at = Date.parse('2026-11-16T09:00:00.000Z')
    expect(cronInstance('0 9 * * *', at)).toEqual({ binding: 'DAILY_SCRAPE', id: 'daily-scrape-202611160900', scheduledTime: '2026-11-16T09:00:00.000Z' })
    expect(() => cronInstance('* * * * *', at)).toThrow('No Workflow for cron')
  })

  it('ignores only a repeated firing ("already exists") and rethrows other create errors', async () => {
    const env = (create: () => Promise<unknown>) => ({ DAILY_SCRAPE: { create: vi.fn(create) }, GUEST_RETENTION: { create: vi.fn() }, ENRICHMENT_CATCHUP: { create: vi.fn() } })
    const firing = { cron: '0 9 * * *', scheduledTime: Date.parse('2026-11-16T09:00:00.000Z') }
    const created = env(async () => ({}))
    await startScheduledWorkflow(firing, created)
    expect(created.DAILY_SCRAPE.create).toHaveBeenCalledWith({ id: 'daily-scrape-202611160900', params: { scheduledTime: '2026-11-16T09:00:00.000Z' } })
    await expect(startScheduledWorkflow(firing, env(async () => { throw new Error('instance.already_exists: Workflow instance already exists') }))).resolves.toBeUndefined()
    await expect(startScheduledWorkflow(firing, env(async () => { throw new Error('Workflows API unavailable') }))).rejects.toThrow('Workflows API unavailable')
  })

  it('starts nothing while DB_READ_ONLY is set (the cutover freeze)', async () => {
    const create = vi.fn(async () => ({}))
    const runTask = vi.fn(async () => ({}))
    const env = { DAILY_SCRAPE: { create }, GUEST_RETENTION: { create }, ENRICHMENT_CATCHUP: { create } }
    for (const cron of ['0 9 * * *', '0 * * * *']) await dispatchCron({ cron, scheduledTime: Date.now() }, { ...env, DB_READ_ONLY: '1' }, runTask)
    expect(create).not.toHaveBeenCalled()
    expect(runTask).not.toHaveBeenCalled()
    await dispatchCron({ cron: '0 * * * *', scheduledTime: Date.now() }, env, runTask)
    await dispatchCron({ cron: '0 9 * * *', scheduledTime: Date.now() }, env, runTask)
    expect(runTask).toHaveBeenCalledWith('mark-past-events', env)
    expect(create).toHaveBeenCalledOnce()
  })
})
