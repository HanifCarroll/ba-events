import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { exportTable, type TableSource } from './export.ts'
import { TABLES } from './lib.ts'

type Row = Record<string, unknown>

/**
 * A PostgREST stand-in that sorts by the requested columns only and, like PostgreSQL, gives no stable order to rows
 * that tie: each request returns tied rows in a different order.
 */
function fakePostgrest(rows: Row[]): TableSource {
	let requests = 0
	const key = (row: Row, column: string) => typeof row[column] === 'string' ? row[column] as string : JSON.stringify(row[column])
	const respond = (path: string) => {
		const url = new URL(path, 'https://example.test')
		const order = url.searchParams.get('order')!.split(',')
		const limit = Number(url.searchParams.get('limit')), offset = Number(url.searchParams.get('offset'))
		const salt = ++requests
		const scramble = (row: Row) => [...JSON.stringify(row)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261 ^ salt) >>> 0
		const sorted = [...rows].sort((a, b) => {
			for (const column of order) { const x = key(a, column), y = key(b, column); if (x !== y) return x < y ? -1 : 1 }
			return scramble(a) - scramble(b)
		})
		return sorted.slice(offset, offset + limit)
	}
	return {
		json: async <T>(path: string) => respond(path) as T,
		get: async () => new Response(null, { headers: { 'content-range': `0-0/${rows.length}` } }),
	}
}

describe('export paging', () => {
	const dir = mkdtempSync(join(tmpdir(), 'd1-migrate-export-'))
	mkdirSync(join(dir, 'raw'))
	afterAll(() => rmSync(dir, { recursive: true }))

	// One venue merge: 1,200 event before-images with the same merged_at and kind.
	const backups: Row[] = Array.from({ length: 1200 }, (_, i) => ({
		merged_at: '2026-11-17T04:00:00.123456+00:00', kind: 'event',
		row: { id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, venue_id: 'v1' },
	}))
	const exported = () => readFileSync(join(dir, 'raw', 'venue_merge_backup.jsonl'), 'utf8').trim().split('\n')

	it('exports every venue_merge_backup before-image exactly once', async () => {
		const order = TABLES.find(([table]) => table === 'venue_merge_backup')![1]
		expect(await exportTable(fakePostgrest(backups), dir, 'venue_merge_backup', order)).toBe(1200)
		const lines = exported()
		expect(new Set(lines).size).toBe(1200)
		expect(new Set(lines)).toEqual(new Set(backups.map((row) => JSON.stringify(row))))
	})

	it('would lose before-images when ordered by merged_at and kind alone', async () => {
		expect(await exportTable(fakePostgrest(backups), dir, 'venue_merge_backup', 'merged_at,kind')).toBe(1200)
		expect(new Set(exported()).size).toBeLessThan(1200)
	})
})
