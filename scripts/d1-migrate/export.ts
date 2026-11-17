/**
 * Step 1 of the copy: production Supabase → a local run directory. Reads only; it never writes to production.
 *
 *   node --env-file=.env scripts/d1-migrate/export.ts --dir <run dir outside the repo>
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Writes, with mode 600:
 *   raw/<table>.jsonl      every row of every production table (PostgREST GET, 1,000-row pages in a stable order)
 *   raw/auth_users.jsonl   the auth users' id, email and whether the email is confirmed, for the Better Auth import (load.ts)
 *   objects/<bucket>/<key> every object of the instagram-evidence and event-artwork buckets, each checked against the
 *                          sha256 its key names
 *   manifest.json          columns, row counts, object hashes
 * Requests: PostgREST and Auth admin GETs, Storage object GETs, and Storage's list call, which is a read-only POST.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { BUCKETS, TABLES, VIEWS, elapsed, jsonlWriter, objectPath, pool, requireDir, sha256, type Manifest } from './lib.ts'
import type { Column } from './transform.ts'

const PAGE = 1000

function source() {
	const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
	if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
	const origin = new URL(url).origin
	const headers = { apikey: key, Authorization: `Bearer ${key}` }
	async function get(path: string, extra: Record<string, string> = {}): Promise<Response> {
		for (let attempt = 1; ; attempt++) {
			const response = await fetch(`${origin}${path}`, { method: 'GET', headers: { ...headers, ...extra } })
			if (response.ok || attempt === 3 || response.status < 500) return response
			await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
		}
	}
	async function json<T>(path: string, extra?: Record<string, string>): Promise<T> {
		const response = await get(path, extra)
		if (!response.ok) throw new Error(`GET ${path.split('?')[0]} failed: ${response.status} ${(await response.text()).slice(0, 200)}`)
		return await response.json() as T
	}
	return { origin, headers, get, json }
}
type Source = ReturnType<typeof source>

async function count(src: TableSource, table: string): Promise<number> {
	const response = await src.get(`/rest/v1/${table}?select=*`, { Prefer: 'count=exact', Range: '0-0' })
	await response.body?.cancel()
	const total = Number(response.headers.get('content-range')?.split('/')[1])
	if (!response.ok || !Number.isInteger(total)) throw new Error(`${table}: count failed (${response.status})`)
	return total
}

// Events carry a 1,536-number embedding each: big offset pages hit production's statement timeout, so events page by id.
const KEYSET: Record<string, number> = { events: 250 }

/** What exportTable needs from the source; tests pass a fake PostgREST. */
export type TableSource = Pick<Source, 'get' | 'json'>

export async function exportTable(src: TableSource, dir: string, table: string, order: string): Promise<number> {
	// A row written between pages would shift the offsets, so the page total must equal an exact count taken after it.
	for (let attempt = 1; attempt <= 3; attempt++) {
		const out = jsonlWriter(join(dir, 'raw', `${table}.jsonl`))
		let rows = 0
		const size = KEYSET[table] ?? PAGE
		let after: unknown = null
		for (let offset = 0; ; offset += size) {
			const page = await src.json<Record<string, unknown>[]>(KEYSET[table]
				? `/rest/v1/${table}?select=*&order=id&limit=${size}${after === null ? '' : `&id=gt.${after as string}`}`
				: `/rest/v1/${table}?select=*&order=${order}&limit=${size}&offset=${offset}`)
			for (const row of page) await out.write(row)
			rows += page.length
			after = page.at(-1)?.id ?? after
			if (page.length < size) break
		}
		await out.close()
		const total = await count(src, table)
		if (total === rows) return rows
		console.warn(`${table}: paged ${rows} rows but production now has ${total}; exporting it again`)
	}
	throw new Error(`${table}: production kept changing during the export`)
}

type StorageObject = { name: string; id: string | null; metadata: { size: number; mimetype: string } | null }

async function listBucket(src: Source, bucket: string): Promise<StorageObject[]> {
	const objects: StorageObject[] = []
	for (let offset = 0; ; offset += PAGE) {
		const response = await fetch(`${src.origin}/storage/v1/object/list/${bucket}`, {
			method: 'POST', headers: { ...src.headers, 'Content-Type': 'application/json' },
			body: JSON.stringify({ prefix: '', limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } }),
		})
		if (!response.ok) throw new Error(`list ${bucket} failed: ${response.status}`)
		const page = await response.json() as StorageObject[]
		objects.push(...page)
		if (page.length < PAGE) break
	}
	const folders = objects.filter((object) => object.id === null)
	if (folders.length) throw new Error(`${bucket}: has folders (${folders.length}); every object is expected at the top level`)
	return objects
}

async function main() {
	const { values } = parseArgs({ options: { dir: { type: 'string' } } })
	const dir = requireDir(values.dir)
	const start = Date.now()
	const src = source()
	mkdirSync(join(dir, 'raw'), { recursive: true, mode: 0o700 })

	// Columns come from PostgREST's schema; a production table missing from TABLES stops the export.
	const spec = await src.json<{ definitions: Record<string, { properties: Record<string, { format?: string; type?: string }> }> }>('/rest/v1/')
	const unknown = Object.keys(spec.definitions).filter((name) => !VIEWS.includes(name) && !TABLES.some(([table]) => table === name))
	const absent = TABLES.filter(([table]) => !spec.definitions[table]).map(([table]) => table)
	if (unknown.length || absent.length) throw new Error(`Table list out of date: new in production ${unknown}, gone from production ${absent}`)

	const manifest: Manifest = { exported_at: new Date().toISOString(), source_origin: src.origin, tables: {}, auth_users: 0, objects: [], missing_objects: [], seconds: 0 }
	for (const [table, order] of TABLES) {
		const tableStart = Date.now()
		const columns: Column[] = Object.entries(spec.definitions[table]!.properties).map(([name, p]) => ({ name, format: p.format, type: p.type }))
		const rows = await exportTable(src, dir, table, order)
		manifest.tables[table] = { columns, rows, production_count: rows }
		console.log(`export ${table}: ${rows} rows in ${elapsed(tableStart)}`)
	}

	const users = await src.json<{ users: Array<{ id: string; email: string | null; email_confirmed_at: string | null }> }>('/auth/v1/admin/users?page=1&per_page=1000')
	const auth = jsonlWriter(join(dir, 'raw', 'auth_users.jsonl'))
	for (const user of users.users) await auth.write({ id: user.id, email: user.email, email_verified: Boolean(user.email_confirmed_at) })
	await auth.close()
	manifest.auth_users = users.users.length
	console.log(`export auth users: ${users.users.length} (id, email and confirmation only)`)

	for (const bucket of Object.values(BUCKETS)) {
		const bucketStart = Date.now()
		mkdirSync(join(dir, 'objects', bucket), { recursive: true, mode: 0o700 })
		const objects = await listBucket(src, bucket)
		await pool(objects, 8, async (object) => {
			const match = /^([0-9a-f]{64})\.(jpg|png|webp)$/.exec(object.name)
			if (!match) throw new Error(`${bucket}: object key is not <sha256>.<ext>`)
			const response = await src.get(`/storage/v1/object/authenticated/${bucket}/${object.name}`)
			if (!response.ok) {
				await response.body?.cancel()
				manifest.missing_objects.push({ bucket, key: object.name, status: response.status })
				return
			}
			const bytes = new Uint8Array(await response.arrayBuffer())
			const hash = sha256(bytes)
			if (hash !== match[1]) throw new Error(`${bucket}/${object.name}: content hash ${hash} does not match its key`)
			writeFileSync(objectPath(dir, bucket, object.name), bytes, { mode: 0o600 })
			manifest.objects.push({ bucket, key: object.name, sha256: hash, size: bytes.length, content_type: response.headers.get('content-type') ?? object.metadata?.mimetype ?? 'application/octet-stream' })
		})
		const copied = manifest.objects.filter((object) => object.bucket === bucket)
		console.log(`export ${bucket}: ${copied.length} objects, ${(copied.reduce((sum, o) => sum + o.size, 0) / 1e6).toFixed(1)} MB in ${elapsed(bucketStart)}`)
	}
	if (manifest.missing_objects.length) throw new Error(`Storage listed ${manifest.missing_objects.length} objects it would not return`)
	manifest.objects.sort((a, b) => `${a.bucket}/${a.key}`.localeCompare(`${b.bucket}/${b.key}`))
	manifest.seconds = Math.round((Date.now() - start) / 1000)
	writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`, { mode: 0o600 })
	console.log(`export done in ${elapsed(start)}`)
}

if (import.meta.main) await main()
