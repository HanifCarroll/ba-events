/**
 * Shared pieces of the Supabase → D1, Vectorize and R2 copy (delivery plan, PR 2 and cutover steps 3 to 5).
 * The pure type map and URL rewrite live in transform.ts so they can be unit-tested without I/O.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createReadStream, createWriteStream, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { D1Database, R2Bucket, Vectorize } from '@cloudflare/workers-types'
import type { Column } from './transform.ts'

/**
 * Production tables in foreign-key order (load inserts in this order and clears in reverse), each with the column list
 * PostgREST pages by. Each order must be unique per row (or tie only on identical rows), or offset pages can skip and
 * repeat rows. Export refuses to run if production has a table that is missing here.
 */
export const TABLES: ReadonlyArray<readonly [table: string, order: string]> = [
	['profiles', 'id'], ['user_preferences', 'id'], ['venues', 'id'], ['events', 'id'], ['saved_events', 'id'],
	['import_blocklist', 'id'], ['scrape_runs', 'id'], ['venue_review_queue', 'id'], ['dismissed_venue_duplicates', 'id'],
	// No key: one merge writes many before-images with the same merged_at and kind, so the row itself breaks ties.
	['venue_merge_backup', 'merged_at,kind,row'], ['conversations', 'id'],
	// User messages sort before assistant messages of the same turn, which the assistant-parent trigger needs.
	['messages', 'conversation_id,turn_index,role.desc,created_at,id'],
	['chat_turns', 'id'], ['guest_chat_debug', 'conversation_id'], ['guest_request_lifecycle', 'request_id'],
	['telegram_updates', 'update_id'], ['product_feedback', 'id'], ['rate_limit_windows', 'scope,identifier_hash,window_starts_at'],
	['intake_policy', 'id'], ['instagram_sources', 'username'], ['intake_runs', 'id'], ['intake_observations', 'id'],
	['intake_media', 'id'], ['intake_candidates', 'id'], ['intake_candidate_revisions', 'candidate_id,revision'],
	['intake_plans', 'id'], ['event_source_evidence', 'event_id,candidate_id,observation_id'], ['event_intake_protection', 'event_id'],
]
export const VIEWS = ['events_with_venues', 'events_admin_list']

/**
 * Tables the pre-switch Workers keep writing during the cutover freeze (it starts only when the cutover code deploys):
 * guest diagnostics and rate-limit windows. Their production counts may grow after the export; losing those rows is
 * accepted (docs/ops/d1-cutover.md). Every other table must still match production exactly.
 */
export const DIAGNOSTIC_TABLES = new Set(['guest_request_lifecycle', 'guest_chat_debug', 'rate_limit_windows'])

/** With --production, the problems a live production count raises against the export. */
export function liveCountProblems(exported: Record<string, number>, live: Record<string, number>): { problems: string[]; tolerated: string[] } {
	const problems: string[] = [], tolerated: string[] = []
	for (const [table, rows] of Object.entries(exported)) {
		if (live[table] === rows) continue
		const line = `${table}: production has ${live[table]} rows, the export ${rows}`
		// Only growth is tolerated, and only in diagnostic tables; a shrink means something deleted rows mid-window.
		if (DIAGNOSTIC_TABLES.has(table) && live[table]! > rows) tolerated.push(line)
		else problems.push(line)
	}
	return { problems, tolerated }
}

/** The Supabase Storage buckets that are copied. `source-acquisitions` is a cache and starts empty. */
export const BUCKETS = { evidence: 'instagram-evidence', artwork: 'event-artwork' } as const

export type Manifest = {
	exported_at: string
	source_origin: string
	tables: Record<string, { columns: Column[]; rows: number; production_count: number | null }>
	auth_users: number
	objects: Array<{ bucket: string; key: string; sha256: string; size: number; content_type: string }>
	missing_objects: Array<{ bucket: string; key: string; status: number }>
	seconds: number
}

export type Targets = { d1: string; vectorize: string; evidenceBucket: string; artworkBucket: string }

/** Every target must end in `-staging` unless `--production` was passed (only Hermes passes it, in the cutover). */
export function checkTargets(targets: Targets, production: boolean): void {
	if (production) return
	const wrong = Object.values(targets).filter((name) => !name.endsWith('-staging'))
	if (wrong.length) throw new Error(`Refusing non-staging target(s) ${wrong.join(', ')}; only the cutover passes --production`)
}

export const targetOptions = {
	dir: { type: 'string' },
	d1: { type: 'string', default: 'baeventos-staging' },
	vectorize: { type: 'string', default: 'baeventos-events-staging' },
	'evidence-bucket': { type: 'string', default: 'baeventos-intake-evidence-staging' },
	'artwork-bucket': { type: 'string', default: 'baeventos-artwork-staging' },
	production: { type: 'boolean', default: false },
} as const

export function targetsFrom(values: { d1?: string; vectorize?: string; 'evidence-bucket'?: string; 'artwork-bucket'?: string }): Targets {
	return { d1: values.d1!, vectorize: values.vectorize!, evidenceBucket: values['evidence-bucket']!, artworkBucket: values['artwork-bucket']! }
}

export function requireDir(dir: string | undefined): string {
	if (!dir) throw new Error('Pass --dir <run directory> (keep it outside the repo; it holds production data)')
	return dir
}

export const readManifest = (dir: string): Manifest => JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest

/** Splits on \n only: readline would also split on U+2028 and U+2029, which JSON strings may contain. */
export async function* readJsonl<T>(file: string): AsyncGenerator<T> {
	let rest = ''
	for await (const chunk of createReadStream(file, { encoding: 'utf8' })) {
		const lines = (rest + (chunk as string)).split('\n')
		rest = lines.pop()!
		for (const line of lines) if (line) yield JSON.parse(line) as T
	}
	if (rest) yield JSON.parse(rest) as T
}

export function jsonlWriter(file: string) {
	const out = createWriteStream(file, { mode: 0o600 })
	return {
		write: (value: unknown) => new Promise<void>((resolve) => { if (out.write(`${JSON.stringify(value)}\n`)) resolve(); else out.once('drain', resolve) }),
		close: () => new Promise<void>((resolve, reject) => out.end((error?: Error | null) => error ? reject(error) : resolve())),
	}
}

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

export async function pool<T>(items: readonly T[], concurrency: number, work: (item: T) => Promise<void>): Promise<void> {
	let next = 0
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
		while (next < items.length) await work(items[next++]!)
	}))
}

export const elapsed = (start: number) => `${((Date.now() - start) / 1000).toFixed(1)} s`

export type Remote = {
	db: D1Database
	vectorize: Vectorize
	evidence: R2Bucket
	artwork: R2Bucket
	dispose: () => Promise<void>
}

const repoRoot = join(import.meta.dirname, '../..')
const accountId = () => /"account_id":\s*"(\w+)"/.exec(readFileSync(join(repoRoot, 'wrangler.staging.jsonc'), 'utf8'))![1]!

/** The repo's Wrangler CLI on the BA Eventos account, run inside the run directory so no repo config applies. */
export const wrangler = (dir: string, args: string[]) => execFileSync(join(repoRoot, 'node_modules/.bin/wrangler'), args,
	{ cwd: dir, encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId() } })

/**
 * Real remote bindings to the targets through Wrangler's platform proxy, using the local `wrangler login`. Run the scripts
 * with node: the remote proxy hangs under Bun 1.3.14.
 */
export async function connect(dir: string, targets: Targets): Promise<Remote> {
	const { getPlatformProxy } = await import('wrangler')
	const info = JSON.parse(wrangler(dir, ['d1', 'info', targets.d1, '--json'])) as { uuid: string }
	const config = join(dir, 'wrangler.copy.json')
	writeFileSync(config, JSON.stringify({
		name: 'baeventos-copy-tool', account_id: accountId(), compatibility_date: '2026-08-25',
		d1_databases: [{ binding: 'DB', database_name: targets.d1, database_id: info.uuid, remote: true }],
		vectorize: [{ binding: 'VECTORIZE', index_name: targets.vectorize, remote: true }],
		r2_buckets: [{ binding: 'EVIDENCE', bucket_name: targets.evidenceBucket, remote: true }, { binding: 'ARTWORK', bucket_name: targets.artworkBucket, remote: true }],
	}))
	const proxy = await getPlatformProxy<{ DB: D1Database; VECTORIZE: Vectorize; EVIDENCE: R2Bucket; ARTWORK: R2Bucket }>({ configPath: config, persist: false, envFiles: [] })
	return { db: proxy.env.DB, vectorize: proxy.env.VECTORIZE, evidence: proxy.env.EVIDENCE, artwork: proxy.env.ARTWORK, dispose: proxy.dispose }
}

export const bucketFor = (remote: Remote, bucket: string) => bucket === BUCKETS.evidence ? remote.evidence : remote.artwork

export const objectPath = (dir: string, bucket: string, key: string) => join(dir, 'objects', bucket, key)
