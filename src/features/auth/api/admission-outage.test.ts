import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

describe('real events/feedback route admission', () => {
  it('returns 503 before payload, database or embedding work when limiter configuration is unavailable', async () => {
    const { stdout } = await promisify(execFile)('bun', [fileURLToPath(new URL('./admission-outage.fixture.ts', import.meta.url))], {
      timeout: 4000, env: { PATH: process.env.PATH },
    })
    const result = JSON.parse(stdout.trim().split('\n').at(-1)!)
    expect(result.networkCalls).toBe(0)
    expect(result.downstream).toBe(0)
    expect(result.results.map((row: { status: number; retryAfter: string }) => [row.status, row.retryAfter])).toEqual([[503, '30'], [503, '30'], [503, '30']])
    expect(result.results[0].body).toEqual({ success: false, error: { message: 'Rate limiting is temporarily unavailable.', code: 'SERVICE_UNAVAILABLE' } })
    expect(result.results[1].body).toEqual(result.results[0].body)
    expect(result.results[2].body.error).toBe('Feedback is temporarily unavailable. Please try again.')
  })
})
