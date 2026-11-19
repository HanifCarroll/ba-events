import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Isolate module mocks and wait for the fixture's exit status without Bun's async stdio close events. */
export function runFixture(script: string, args: string[], env: Record<string, string>, timeoutMs: number): void {
	// Exit-only fixtures start with a nonzero exit code and set it to 0 only after all assertions pass.
	execFileSync('bun', ['--no-env-file', script, ...args], {
		timeout: timeoutMs, killSignal: 'SIGKILL', stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8',
		env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', ...env }, maxBuffer: 16 * 1024 * 1024,
	})
}

/** Read the fixture result only after a successful exit; stdout is not a reliable data channel under Bun. */
export function runJsonFixture(script: URL, args: string[], env: Record<string, string>, timeoutMs: number) {
	const dir = mkdtempSync(join(tmpdir(), 'ba-fixture-'))
	try {
		const output = join(dir, 'result.json')
		runFixture(fileURLToPath(script), [output, ...args], env, timeoutMs)
		return JSON.parse(readFileSync(output, 'utf8'))
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
}
