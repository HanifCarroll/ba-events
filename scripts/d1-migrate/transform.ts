/**
 * Step 2 of the copy: raw production JSONL → D1 rows and Vectorize NDJSON. No network.
 *
 *   node scripts/d1-migrate/transform.ts --dir <run dir> [--site-origin https://baeventos.com]
 *
 * Writes <dir>/d1/<table>.jsonl (column values in the D1 form of migrations/0001_baseline.sql) and <dir>/vectors.ndjson
 * (one Vectorize record per event, the embedding copied unchanged). The pure functions below are the type map; load
 * and verify use them too.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { elapsed, jsonlWriter, readJsonl, readManifest, requireDir } from './lib.ts'

export type Column = { name: string; format?: string; type?: string }
export type D1Value = string | number | null
export type VectorRecord = { id: string; values: number[]; metadata: { status: string; starts_at: number } }

type Kind = 'boolean' | 'timestamp' | 'json' | 'vector' | 'plain'

/** The baseline's type map, keyed on the PostgREST OpenAPI column format. */
export function kindOf(column: Column): Kind {
	const format = column.format ?? ''
	if (format === 'boolean') return 'boolean'
	if (format.startsWith('timestamp')) return 'timestamp'
	if (format === 'jsonb' || format === 'json' || column.type === 'array') return 'json'
	if (format.includes('vector(')) return 'vector'
	// text, uuid, date, enums (public.*), integer, bigint, smallint, numeric (PostgREST already sends a JSON number).
	return 'plain'
}

/** One production value in the form D1 stores. Timestamps keep millisecond precision (Postgres has microseconds). */
export function encodeValue(column: Column, value: unknown): D1Value {
	if (value === null || value === undefined) return null
	switch (kindOf(column)) {
		case 'boolean':
			if (typeof value !== 'boolean') throw new Error(`${column.name}: expected a boolean`)
			return value ? 1 : 0
		case 'timestamp': {
			const ms = Date.parse(value as string)
			if (typeof value !== 'string' || Number.isNaN(ms)) throw new Error(`${column.name}: invalid timestamp`)
			return new Date(ms).toISOString()
		}
		case 'json':
			return JSON.stringify(value)
		case 'vector':
			throw new Error(`${column.name}: vectors go to Vectorize, not D1`)
		case 'plain':
			if (typeof value === 'string' || typeof value === 'number') return value
			throw new Error(`${column.name}: unexpected ${typeof value}`)
	}
}

/** A D1 value read back, in the shape PostgREST gives (JSON parsed, booleans as booleans, ISO timestamps). */
export function decodeValue(column: Column, value: D1Value): unknown {
	if (value === null) return null
	switch (kindOf(column)) {
		case 'boolean': return value === 1
		case 'json': return JSON.parse(value as string)
		default: return value
	}
}

/** Whether a production value and a decoded D1 value are the same fact. Timestamps compare as instants (to the ms). */
export function sameValue(column: Column, production: unknown, decoded: unknown): boolean {
	if (production === null || production === undefined || decoded === null) return (production ?? null) === decoded
	if (kindOf(column) === 'timestamp') return Date.parse(production as string) === Date.parse(decoded as string)
	return JSON.stringify(canonical(production)) === JSON.stringify(canonical(decoded))
}

const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
	: value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]))
	: value

/**
 * The public URL of an object in Supabase's `event-artwork` bucket becomes the site's artwork route for that event,
 * keeping the object key (the R2 key in the artwork bucket) as the last path segment:
 *   https://<ref>.supabase.co/storage/v1/object/public/event-artwork/<sha256>.jpg
 *   → https://baeventos.com/api/event-artwork/<event id>/<sha256>.jpg
 * Any other URL is returned unchanged.
 */
export function rewriteArtworkUrl(url: string | null, eventId: string, sourceOrigin: string, siteOrigin: string): string | null {
	if (url === null) return null
	const prefix = `${new URL(sourceOrigin).origin}/storage/v1/object/public/event-artwork/`
	if (!url.startsWith(prefix)) return url
	const key = url.slice(prefix.length)
	if (!/^[0-9a-f]{64}\.(jpg|png|webp)$/.test(key)) throw new Error(`event ${eventId}: unexpected artwork key`)
	return `${new URL(siteOrigin).origin}/api/event-artwork/${eventId}/${key}`
}

/** The R2 key an artwork URL names, if it is one (either form). */
export const artworkKey = (url: string | null) => url?.match(/\/(?:event-artwork|api\/event-artwork\/[0-9a-f-]{36})\/([0-9a-f]{64}\.(?:jpg|png|webp))$/)?.[1] ?? null

/** Production row → expected production values after the copy's only data change (the artwork URL rewrite). */
export function expectedRow(table: string, row: Record<string, unknown>, sourceOrigin: string, siteOrigin: string): Record<string, unknown> {
	if (table !== 'events') return row
	return { ...row, image_url: rewriteArtworkUrl(row.image_url as string | null, row.id as string, sourceOrigin, siteOrigin) }
}

/** The D1 columns of a production table: every column except the embedding. */
export const d1Columns = (columns: Column[]) => columns.filter((column) => kindOf(column) !== 'vector')

export function transformRow(table: string, columns: Column[], row: Record<string, unknown>, sourceOrigin: string, siteOrigin: string): D1Value[] {
	const expected = expectedRow(table, row, sourceOrigin, siteOrigin)
	return d1Columns(columns).map((column) => encodeValue(column, expected[column.name]))
}

/**
 * An event's Vectorize record (the contract plan PR 3 searches with): id = event id, the embedding unchanged, and
 * metadata `status` and `starts_at` in epoch milliseconds.
 */
export function vectorRecord(row: Record<string, unknown>): VectorRecord | null {
	if (row.embedding === null || row.embedding === undefined) return null
	const values = typeof row.embedding === 'string' ? JSON.parse(row.embedding) as unknown : row.embedding
	if (!Array.isArray(values) || values.length !== 1536 || !values.every((v) => typeof v === 'number' && Number.isFinite(v))) {
		throw new Error(`event ${row.id as string}: embedding is not 1536 numbers`)
	}
	return { id: row.id as string, values, metadata: { status: row.status as string, starts_at: Date.parse(row.starts_at as string) } }
}

async function main() {
	const { values } = parseArgs({ options: { dir: { type: 'string' }, 'site-origin': { type: 'string', default: 'https://baeventos.com' } } })
	const dir = requireDir(values.dir)
	const siteOrigin = values['site-origin']!
	const manifest = readManifest(dir)
	mkdirSync(join(dir, 'd1'), { recursive: true, mode: 0o700 })
	const start = Date.now()
	const vectors = jsonlWriter(join(dir, 'vectors.ndjson'))
	let vectorCount = 0, rewritten = 0
	for (const [table, info] of Object.entries(manifest.tables)) {
		const out = jsonlWriter(join(dir, 'd1', `${table}.jsonl`))
		let rows = 0
		for await (const row of readJsonl<Record<string, unknown>>(join(dir, 'raw', `${table}.jsonl`))) {
			const values = transformRow(table, info.columns, row, manifest.source_origin, siteOrigin)
			await out.write(values)
			rows++
			if (table === 'events') {
				if (row.image_url !== expectedRow(table, row, manifest.source_origin, siteOrigin).image_url) rewritten++
				const vector = vectorRecord(row)
				if (vector) { await vectors.write(vector); vectorCount++ }
			}
		}
		await out.close()
		if (rows !== info.rows) throw new Error(`${table}: transformed ${rows} rows, exported ${info.rows}`)
	}
	await vectors.close()
	writeFileSync(join(dir, 'transform.json'), `${JSON.stringify({ site_origin: siteOrigin, vectors: vectorCount, artwork_urls_rewritten: rewritten }, null, 1)}\n`)
	console.log(`transform: ${Object.keys(manifest.tables).length} tables, ${vectorCount} vectors, ${rewritten} artwork URLs rewritten in ${elapsed(start)}`)
}

if (import.meta.main) await main()
