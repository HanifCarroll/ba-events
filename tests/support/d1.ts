import childProcess, { type ChildProcess } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'
import { getPlatformProxy, unstable_splitSqlQuery } from 'wrangler'

const root = join(import.meta.dirname, '../..')

type Proxy = Awaited<ReturnType<typeof getPlatformProxy<{ DB: D1Database }>>>

/** Exercise the SQL backstop directly, independent of application write policy. */
export const withTestIntakeContext = (db: D1Database, statements: D1PreparedStatement[]) => db.batch([
	db.prepare('INSERT INTO write_context (intake_commit) VALUES (1)'), ...statements, db.prepare('DELETE FROM write_context'),
])

/** How long one Miniflare start may take before it is abandoned and tried again. */
const START_TIMEOUT_MS = 20_000
const START_ATTEMPTS = 3

/**
 * Bun 1.3.14 sometimes fails to open a child's extra stdio pipe (`connect ENOENT` on fd 3; about 1 spawn in 10 in a
 * plain `bun` loop). Miniflare reads workerd's ready signal from fd 3 and has no listener for that error, so under
 * Bun-based fuzzing and local diagnostics still need this. While Miniflare starts, listen on fd 3 and kill a
 * workerd whose pipe failed, so the start fails at once and is retried. The Node test runner does not need this.
 */
function watchControlPipes(onBrokenPipe: () => void) {
	const spawn = childProcess.spawn
	childProcess.spawn = ((...args: Parameters<typeof spawn>) => {
		const child = spawn(...args) as ChildProcess
		const control = child.stdio[3] as Readable | null | undefined
		control?.on('error', () => {
			onBrokenPipe()
			// Miniflare may still be writing the config; that start is abandoned, so its EPIPE is expected.
			child.stdin?.on('error', () => undefined)
			child.kill()
		})
		return child
	}) as typeof spawn
	return () => { childProcess.spawn = spawn }
}

function openProxy() {
	return getPlatformProxy<{ DB: D1Database }>({
		configPath: join(root, 'tests/support/wrangler.d1-test.jsonc'),
		persist: false,
		remoteBindings: false,
		envFiles: [],
	})
}

/** Retries a Bun startup that fails or never settles. */
async function startProxy(): Promise<Proxy> {
	if (!('Bun' in globalThis)) return openProxy()
	let brokenPipes = 0
	const restore = watchControlPipes(() => { brokenPipes++ })
	try {
		for (let attempt = 1; ; attempt++) {
			const start = openProxy()
			let timer: ReturnType<typeof setTimeout> | undefined
			const timedOut = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), START_TIMEOUT_MS) })
			let failure: unknown
			const proxy = await Promise.race([start, timedOut])
				.catch((error: unknown) => { failure = error; return null })
				.finally(() => clearTimeout(timer))
			if (proxy) return proxy
			// If the abandoned start finishes after all, stop its workerd.
			void start.then((late) => late.dispose(), () => undefined)
			if (attempt === START_ATTEMPTS) {
				throw new Error(`Miniflare did not start in ${START_ATTEMPTS} attempts (${brokenPipes} broken control pipes)`, { cause: failure })
			}
		}
	} finally {
		restore()
	}
}

/**
 * A fresh, empty Miniflare D1 database with every file in `migrations/` applied in order, the way
 * `wrangler d1 migrations apply` does. Nothing is persisted; call `dispose()` when the test file is done.
 */
export async function freshD1(through?: string): Promise<{ db: D1Database; dispose: () => Promise<void> }> {
	const proxy = await startProxy()
	const db = proxy.env.DB
	const dir = join(root, 'migrations')
	for (const file of (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort()) {
		if (through && file > through) break
		await applyD1Migration(db, file)
	}
	return { db, dispose: proxy.dispose }
}

export async function applyD1Migration(db: D1Database, file: string) {
	const statements = unstable_splitSqlQuery(await readFile(join(root, 'migrations', file), 'utf8'))
	await db.batch(statements.map((sql) => db.prepare(sql)))
}
