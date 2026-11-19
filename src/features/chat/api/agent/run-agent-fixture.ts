import { runJsonFixture } from '../../../../../tests/support/run-fixture.ts'

export function runAgentFixture(script: URL, ...args: string[]) {
  return runJsonFixture(script, args, { AI_API_KEY: 'test-only-key', LANGFUSE_TRACING_ENABLED: 'false' }, 15_000)
}
