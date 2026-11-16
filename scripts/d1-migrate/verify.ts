/**
 * Step 4 of the copy: check the targets against the export. Exits 1 on any mismatch.
 *
 *   node --env-file=.env scripts/d1-migrate/verify.ts --dir <run dir> [target options as for load.ts] [--production]
 *
 * Checks: every table's D1 row count equals the export; 100 events and 50 venues, spread evenly over the export, equal
 * production field by field after decoding (the only expected change is the artwork URL rewrite); the Vectorize index
 * holds exactly one vector per exported embedding, and 100 sampled vectors equal production's values and metadata; and
 * every exported object is in its R2 bucket with the sha256 its key names, with nothing extra.
 * With SUPABASE_URL set it also prints production's live row counts. A difference fails only with --production
 * (the cutover freezes writes); on staging, production keeps changing after the export.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import type { R2Bucket } from '@cloudflare/workers-types'
import { BUCKETS, bucketFor, checkTargets, connect, elapsed, pool, readJsonl, readManifest, requireDir, targetOptions, targetsFrom } from './lib.ts'
import { d1Columns, decodeValue, expectedRow, sameValue, type D1Value, type VectorRecord } from './transform.ts'

/** n rows spread evenly over the export, so the sample is the same on every run. */
async function sample(file: string, total: number, n: number): Promise<Record<string, unknown>[]> {
	const step = Math.max(1, Math.floor(total / n))
	const rows: Record<string, unknown>[] = []
	let i = 0
	for await (const row of readJsonl<Record<string, unknown>>(file)) if (i++ % step === 0 && rows.length < n) rows.push(row)
	return rows
}

async function liveCounts(tables: string[]): Promise<Record<string, number> | null> {
	const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
	if (!url || !key) return null
	const counts: Record<string, number> = {}
	for (const table of tables) {
		const response = await fetch(`${new URL(url).origin}/rest/v1/${table}?select=*`, { method: 'GET',
			headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact', Range: '0-0' } })
		await response.body?.cancel()
		counts[table] = Number(response.headers.get('content-range')?.split('/')[1])
	}
	return counts
}

async function listKeys(bucket: R2Bucket): Promise<string[]> {
	const keys: string[] = []
	let cursor: string | undefined
	do {
		const page = await bucket.list({ limit: 1000, cursor })
		keys.push(...page.objects.map((o) => o.key))
		cursor = page.truncated ? page.cursor : undefined
	} while (cursor)
	return keys
}

async function main() {
	const { values } = parseArgs({ options: { ...targetOptions, 'vector-wait': { type: 'string', default: '600' } } })
	const dir = requireDir(values.dir)
	const targets = targetsFrom(values)
	checkTargets(targets, values.production!)
	const manifest = readManifest(dir)
	const transformInfo = JSON.parse(readFileSync(join(dir, 'transform.json'), 'utf8')) as { site_origin: string; vectors: number }
	const problems: string[] = []
	const start = Date.now()
	const remote = await connect(dir, targets)
	try {
		// 1. Row counts.
		const live = await liveCounts(Object.keys(manifest.tables))
		console.log(`table                          export      D1${live ? '  production now' : ''}`)
		for (const [table, info] of Object.entries(manifest.tables)) {
			const d1 = (await remote.db.prepare(`SELECT count(*) AS n FROM "${table}"`).first<number>('n'))!
			if (d1 !== info.rows) problems.push(`${table}: D1 has ${d1} rows, the export ${info.rows}`)
			if (live && values.production && live[table] !== info.rows) problems.push(`${table}: production has ${live[table]} rows, the export ${info.rows}`)
			console.log(`${table.padEnd(28)} ${String(info.rows).padStart(8)} ${String(d1).padStart(7)}${live ? String(live[table]).padStart(16) : ''}${d1 !== info.rows ? '  MISMATCH' : ''}`)
		}
		const totalRows = Object.values(manifest.tables).reduce((sum, t) => sum + t.rows, 0)
		console.log(`rows: ${totalRows} in ${Object.keys(manifest.tables).length} tables`)

		// 2. Field by field.
		for (const [table, n] of [['events', 100], ['venues', 50]] as const) {
			const columns = d1Columns(manifest.tables[table]!.columns)
			const rows = await sample(join(dir, 'raw', `${table}.jsonl`), manifest.tables[table]!.rows, n)
			let equal = 0
			for (const row of rows) {
				const expected = expectedRow(table, row, manifest.source_origin, transformInfo.site_origin)
				const stored = await remote.db.prepare(`SELECT ${columns.map((c) => `"${c.name}"`).join(', ')} FROM "${table}" WHERE id = ?`).bind(row.id).first<Record<string, D1Value>>()
				const different = stored ? columns.filter((c) => !sameValue(c, expected[c.name], decodeValue(c, stored[c.name]))).map((c) => c.name) : ['(missing row)']
				if (different.length) problems.push(`${table} ${row.id as string}: ${different.join(', ')} differ`)
				else equal++
			}
			console.log(`fields ${table}: ${equal} of ${rows.length} sampled rows equal in all ${columns.length} columns`)
		}

		// 3. Vectorize. Upserts apply asynchronously, so wait until the index has processed them.
		const waitUntil = Date.now() + Number(values['vector-wait']) * 1000
		let info = await remote.vectorize.describe()
		while (info.vectorCount !== transformInfo.vectors && Date.now() < waitUntil) {
			await new Promise((resolve) => setTimeout(resolve, 10_000))
			info = await remote.vectorize.describe()
		}
		if (info.vectorCount !== transformInfo.vectors) problems.push(`Vectorize has ${info.vectorCount} vectors, the export ${transformInfo.vectors}`)
		const vectorSample = await sample(join(dir, 'vectors.ndjson'), transformInfo.vectors, 100) as unknown as VectorRecord[]
		const stored = new Map<string, Awaited<ReturnType<typeof remote.vectorize.getByIds>>[number]>()
		for (let i = 0; i < vectorSample.length; i += 20) { // getByIds takes at most 20 ids.
			for (const v of await remote.vectorize.getByIds(vectorSample.slice(i, i + 20).map((r) => r.id))) stored.set(v.id, v)
		}
		let vectorsEqual = 0
		for (const expected of vectorSample) {
			const got = stored.get(expected.id)
			const values = got ? Array.from(got.values as ArrayLike<number>) : []
			// Vectorize stores float32.
			const ok = got && values.length === 1536 && values.every((v, i) => Math.abs(v - expected.values[i]!) <= 1e-6)
				&& got.metadata?.status === expected.metadata.status && got.metadata?.starts_at === expected.metadata.starts_at
			if (ok) vectorsEqual++
			else problems.push(`vector ${expected.id}: ${got ? 'values or metadata differ' : 'missing'}`)
		}
		console.log(`vectorize: ${info.vectorCount} vectors (export ${transformInfo.vectors}); ${vectorsEqual} of ${vectorSample.length} sampled equal in values and metadata`)

		// 4. R2: every object's stored sha256, and no extra keys.
		for (const name of Object.values(BUCKETS)) {
			const expected = manifest.objects.filter((o) => o.bucket === name)
			const bucket = bucketFor(remote, name)
			let ok = 0
			await pool(expected, 16, async (object) => {
				const head = await bucket.head(object.key)
				const hash = head?.checksums.toJSON().sha256
				if (hash === object.sha256 && object.key.startsWith(hash) && head!.size === object.size) ok++
				else problems.push(`r2 ${name}/${object.key}: ${head ? 'hash or size differs' : 'missing'}`)
			})
			const keys = new Set(expected.map((o) => o.key))
			const extra = (await listKeys(bucket)).filter((key) => !keys.has(key))
			if (extra.length) problems.push(`r2 ${name}: ${extra.length} objects that production lacks`)
			console.log(`r2 ${name}: ${ok} of ${expected.length} objects match their sha256 key; ${extra.length} extra`)
		}
	} finally { await remote.dispose() }
	console.log(`verify ran in ${elapsed(start)}`)
	if (problems.length) {
		console.log(`VERIFY FAIL (${problems.length}):\n${problems.slice(0, 50).join('\n')}`)
		process.exit(1)
	}
	console.log('VERIFY PASS')
}

if (import.meta.main) await main()
