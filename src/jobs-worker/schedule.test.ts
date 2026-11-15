import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CRON_WORKFLOWS, cronInstance } from './schedule.ts'

describe('jobs schedule', () => {
  it('maps exactly the configured crons, at the old Buenos Aires times', () => {
    const config = readFileSync(new URL('../../wrangler.jobs.jsonc', import.meta.url), 'utf8')
    const crons = JSON.parse(config.match(/"crons":\s*(\[[^\]]*\])/)![1]) as string[]
    expect(crons.sort()).toEqual(Object.keys(CRON_WORKFLOWS).sort())
    expect(config).not.toContain('"schedules"')
  })

  it('names one instance per firing and rejects unknown crons', () => {
    const at = Date.parse('2026-11-16T09:00:00.000Z')
    expect(cronInstance('0 9 * * *', at)).toEqual({ binding: 'DAILY_SCRAPE', id: 'daily-scrape-202611160900', scheduledTime: '2026-11-16T09:00:00.000Z' })
    expect(() => cronInstance('* * * * *', at)).toThrow('No Workflow for cron')
  })
})
