import { execFile } from 'node:child_process'

/**
 * Run a Bun fixture script (module mocks that must not leak into other suites) in a child process and resolve when it
 * passed. The child must start with `process.exitCode = 3` and set it to 0 after its last assertion, so the exit code
 * is the result: a child that stops early, throws, or loses its output fails here, with its stderr in the message. It
 * runs with `--no-env-file` and only the env given, so the clone's `.env` and the machine's environment don't count.
 */
export function runFixture(script: string, args: string[], env: Record<string, string>, timeoutMs: number): Promise<void> {
	return new Promise((resolve, reject) => {
		execFile('bun', ['--no-env-file', script, ...args], { timeout: timeoutMs, env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', ...env }, maxBuffer: 16 * 1024 * 1024 },
			(error, _stdout, stderr) => error
				? reject(new Error(`${script} ${args.join(' ')} failed (exit ${(error as { code?: unknown }).code ?? '?'}, signal ${(error as { signal?: unknown }).signal ?? 'none'}):\n${stderr.slice(-4000)}`))
				: resolve())
	})
}
