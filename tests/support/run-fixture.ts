import { execFileSync } from 'node:child_process'

/** Isolate module mocks and wait for the fixture's exit status without Bun's async stdio close events. */
export function runFixture(script: string, args: string[], env: Record<string, string>, timeoutMs: number): void {
	// Fixtures start with a nonzero exit code and set it to 0 only after all assertions pass.
	execFileSync('bun', ['--no-env-file', script, ...args], {
		timeout: timeoutMs, killSignal: 'SIGKILL', stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8',
		env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', ...env }, maxBuffer: 16 * 1024 * 1024,
	})
}
