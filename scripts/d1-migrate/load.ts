/**
 * Step 3 of the copy: the transformed run directory → a target D1, Vectorize index and two R2 buckets.
 *
 *   node scripts/d1-migrate/load.ts --dir <run dir> [--d1 baeventos-staging] [--vectorize baeventos-events-staging]
 *     [--evidence-bucket baeventos-intake-evidence-staging] [--artwork-bucket baeventos-artwork-staging] [--production]
 *
 * Every target must end in `-staging` unless --production is passed; only Hermes passes it, in the cutover.
 * D1: empties every copied table (the migrations must already be applied), then inserts 500-row db.batch() calls in
 * foreign-key order. Vectorize: upserts the event vectors in batches of 1,000 and deletes ids that are not events.
 * R2: puts each object with its sha256, which R2 checks on upload; objects already there with that hash are skipped.
 * Users: the Supabase auth users become Better Auth users with the same ids, each with an email account (users.ts).
 * `--only d1,users,vectorize,r2` picks parts; `--only users` reimports the users alone, leaving the tables as they are.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import type { D1PreparedStatement } from '@cloudflare/workers-types'
import { TABLES, bucketFor, checkTargets, connect, elapsed, objectPath, pool, readJsonl, readManifest, requireDir, targetOptions, targetsFrom, wrangler, type Remote } from './lib.ts'
import { d1Columns, type D1Value, type VectorRecord } from './transform.ts'
import { importUsers, type AuthUser } from './users.ts'

const D1_BATCH = 500
const D1_BATCH_BYTES = 4_000_000 // Keeps big JSON rows (plans, chat debug) under the request size limit.
const VECTOR_BATCH = 1000

async function loadD1(remote: Remote, dir: string) {
	const manifest = readManifest(dir)
	const start = Date.now()
	const tables = TABLES.map(([table]) => table)
	const present = new Set((await remote.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all<{ name: string }>()).results.map((r) => r.name))
	const missing = tables.filter((table) => !present.has(table))
	if (missing.length) throw new Error(`Target D1 lacks ${missing.join(', ')}; apply migrations/ first`)
	// Reverse foreign-key order. intake_policy's seed row goes too: production's row replaces it.
	await remote.db.batch([...tables].reverse().map((table) => remote.db.prepare(`DELETE FROM "${table}"`)))
	console.log(`load d1: emptied ${tables.length} tables in ${elapsed(start)}`)
	for (const table of tables) {
		const tableStart = Date.now()
		const columns = d1Columns(manifest.tables[table]!.columns)
		const sql = `INSERT INTO "${table}" (${columns.map((c) => `"${c.name}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
		let batch: D1PreparedStatement[] = [], bytes = 0, rows = 0
		const flush = async () => {
			if (!batch.length) return
			await remote.db.batch(batch)
			rows += batch.length
			batch = []; bytes = 0
		}
		for await (const values of readJsonl<D1Value[]>(join(dir, 'd1', `${table}.jsonl`))) {
			const size = values.reduce<number>((sum, v) => sum + (typeof v === 'string' ? v.length * 3 : 8), 0)
			if (batch.length === D1_BATCH || (batch.length && bytes + size > D1_BATCH_BYTES)) await flush()
			batch.push(remote.db.prepare(sql).bind(...values))
			bytes += size
		}
		await flush()
		if (rows !== manifest.tables[table]!.rows) throw new Error(`${table}: loaded ${rows} rows, exported ${manifest.tables[table]!.rows}`)
		console.log(`load d1 ${table}: ${rows} rows in ${elapsed(tableStart)}`)
	}
	console.log(`load d1 done in ${elapsed(start)}`)
}

/** Every vector id in the index, through Wrangler (the binding cannot list). */
export function listVectorIds(dir: string, index: string): string[] {
	const ids: string[] = []
	let cursor: string | undefined
	do {
		const args = ['vectorize', 'list-vectors', index, '--count', '1000', '--json', ...(cursor ? ['--cursor', cursor] : [])]
		type Page = { vectors: Array<{ id: string }>; nextCursor?: string | null; isTruncated?: boolean }
		let page: Page
		// The list endpoint answers 504 now and then, mostly while the index is still applying upserts, and Wrangler
		// sometimes exits 0 with no JSON then; both are retried.
		for (let attempt = 1; ; attempt++) {
			try {
				const out = wrangler(dir, args)
				page = JSON.parse(out.slice(out.indexOf('{'))) as Page
				break
			} catch (error) {
				if (attempt === 5) throw error
				execFileSync('sleep', [String(15 * attempt)])
			}
		}
		ids.push(...page.vectors.map((v) => v.id))
		cursor = page.isTruncated ? page.nextCursor ?? undefined : undefined
	} while (cursor)
	return ids
}

async function loadVectors(remote: Remote, dir: string, index: string) {
	const start = Date.now()
	const keep = new Set<string>()
	let batch: VectorRecord[] = [], loaded = 0
	const flush = async () => {
		if (!batch.length) return
		for (let attempt = 1; ; attempt++) {
			try { await remote.vectorize.upsert(batch); break } catch (error) {
				if (attempt === 3) throw error
				await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
			}
		}
		loaded += batch.length
		batch = []
	}
	for await (const record of readJsonl<VectorRecord>(join(dir, 'vectors.ndjson'))) {
		keep.add(record.id)
		batch.push(record)
		if (batch.length === VECTOR_BATCH) await flush()
	}
	await flush()
	console.log(`load vectorize: upserted ${loaded} vectors in ${elapsed(start)}`)
	const stale = listVectorIds(dir, index).filter((id) => !keep.has(id))
	for (let i = 0; i < stale.length; i += 1000) await remote.vectorize.deleteByIds(stale.slice(i, i + 1000))
	console.log(`load vectorize: deleted ${stale.length} vectors that are not events; done in ${elapsed(start)}`)
}

async function loadObjects(remote: Remote, dir: string) {
	const { objects } = readManifest(dir)
	const start = Date.now()
	let put = 0, skipped = 0
	await pool(objects, 8, async (object) => {
		const bucket = bucketFor(remote, object.bucket)
		const head = await bucket.head(object.key)
		if (head?.checksums.toJSON().sha256 === object.sha256) { skipped++; return }
		const bytes = readFileSync(objectPath(dir, object.bucket, object.key))
		// R2 refuses the put if the bytes don't hash to object.sha256.
		await bucket.put(object.key, bytes, { sha256: object.sha256, httpMetadata: { contentType: object.content_type,
			...(object.bucket === 'event-artwork' ? { cacheControl: 'public, max-age=31536000, immutable' } : {}) } })
		put++
	})
	console.log(`load r2: ${put} objects put, ${skipped} already present with the same hash, in ${elapsed(start)}`)
}

async function loadUsers(remote: Remote, dir: string) {
	const users: AuthUser[] = []
	for await (const user of readJsonl<AuthUser>(join(dir, 'raw', 'auth_users.jsonl'))) users.push(user)
	if (users.length !== readManifest(dir).auth_users) throw new Error(`auth_users.jsonl has ${users.length} users, the manifest ${readManifest(dir).auth_users}`)
	console.log(`load users: ${await importUsers(remote.db, users)} Better Auth users with their Supabase ids`)
}

async function main() {
	const { values } = parseArgs({ options: { ...targetOptions, only: { type: 'string' } } })
	const dir = requireDir(values.dir)
	const targets = targetsFrom(values)
	checkTargets(targets, values.production!)
	const only = values.only?.split(',') ?? ['d1', 'users', 'vectorize', 'r2']
	const start = Date.now()
	console.log(`load into D1 ${targets.d1}, Vectorize ${targets.vectorize}, R2 ${targets.evidenceBucket} and ${targets.artworkBucket}`)
	const remote = await connect(dir, targets)
	try {
		if (only.includes('d1')) await loadD1(remote, dir)
		if (only.includes('users')) await loadUsers(remote, dir)
		if (only.includes('vectorize')) await loadVectors(remote, dir, targets.vectorize)
		if (only.includes('r2')) await loadObjects(remote, dir)
	} finally { await remote.dispose() }
	console.log(`load done in ${elapsed(start)}`)
}

if (import.meta.main) await main()
