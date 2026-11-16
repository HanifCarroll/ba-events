import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { D1Database } from '@cloudflare/workers-types'
import { getPlatformProxy, unstable_splitSqlQuery } from 'wrangler'

const root = join(import.meta.dirname, '../..')

/**
 * A fresh, empty Miniflare D1 database with every file in `migrations/` applied in order, the way
 * `wrangler d1 migrations apply` does. Nothing is persisted; call `dispose()` when the test file is done.
 */
export async function freshD1(): Promise<{ db: D1Database; dispose: () => Promise<void> }> {
	const proxy = await getPlatformProxy<{ DB: D1Database }>({
		configPath: join(root, 'tests/support/wrangler.d1-test.jsonc'),
		persist: false,
		remoteBindings: false,
		envFiles: [],
	})
	const db = proxy.env.DB
	const dir = join(root, 'migrations')
	for (const file of (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort()) {
		const statements = unstable_splitSqlQuery(await readFile(join(dir, file), 'utf8'))
		await db.batch(statements.map((sql) => db.prepare(sql)))
	}
	return { db, dispose: proxy.dispose }
}
