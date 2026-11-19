import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Keep the real SDK isolated from module mocks and avoid Bun's intermittent stdout pipe closure on CI. */
export function runAgentFixture(script: URL, ...args: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'ba-agent-fixture-'))
  try {
    const output = join(dir, 'result.json')
    execFileSync('bun', ['--no-env-file', fileURLToPath(script), output, ...args], {
      timeout: 15_000, killSignal: 'SIGKILL', stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8',
      env: { PATH: process.env.PATH, AI_API_KEY: 'test-only-key', LANGFUSE_TRACING_ENABLED: 'false' },
    })
    return JSON.parse(readFileSync(output, 'utf8'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
