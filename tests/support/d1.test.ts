import childProcess from 'node:child_process'
import { expect, it, vi } from 'vitest'
import { freshD1 } from './d1.ts'

// Bun sometimes fails to open workerd's fd-3 control pipe; freshD1 must retry instead of hanging or erroring.
it('retries a Miniflare start whose control pipe breaks', async () => {
	vi.stubGlobal('Bun', {})
	const spawn = childProcess.spawn
	let spawns = 0
	childProcess.spawn = ((...args: Parameters<typeof spawn>) => {
		const child = spawn(...args)
		if (spawns++ === 0) setImmediate(() => child.stdio[3]?.emit('error', Object.assign(new Error('Failed to connect'), { code: 'ENOENT' })))
		return child
	}) as typeof spawn
	try {
		const { db, dispose } = await freshD1()
		expect(await db.prepare('SELECT count(*) AS n FROM users').first('n')).toBe(0)
		await dispose()
	} finally {
		childProcess.spawn = spawn
		vi.unstubAllGlobals()
	}
	expect(spawns).toBeGreaterThan(1)
}, 90_000)
