import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

describe('catalog importers on D1', () => {
  it('imports Luma, Meetup, and BA Tourism into D1 and Vectorize: blocklist, venues, hidden locations, and an unchanged re-run', async () => {
    const { stdout } = await promisify(execFile)('bun', [fileURLToPath(new URL('./importers-d1.fixture.ts', import.meta.url))], {
      timeout: 90_000, env: { PATH: process.env.PATH, AI_API_KEY: 'fixture', LANGFUSE_TRACING_ENABLED: 'false', NODE_ENV: 'test' },
    })
    expect(JSON.parse(stdout.trim().split('\n').at(-1)!)).toEqual({ passed: ['luma', 'meetup', 'ba-tourism'] })
  }, 90_000)
})
