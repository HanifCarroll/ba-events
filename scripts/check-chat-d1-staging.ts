/**
 * Checks the chat, Telegram, feedback, and rate-limit D1 code (delivery PR 05) against the copied data in
 * `baeventos-staging`, without changing it:
 *   1. Reads: the repository readers run against the remote staging D1 through a wrapper that refuses anything but SELECT.
 *   2. Writes: the chat tables are exported from staging into a local Miniflare D1 with the real migrations, and the write
 *      paths run there, on copies of the real rows.
 * Prints counts and outcomes only: no message text, ids, hashes, or emails. Exits 1 on any failure.
 *
 *   node scripts/check-chat-d1-staging.ts
 *
 * Run it with node (Wrangler's remote proxy hangs under Bun). The export goes to a mode-700 temp folder that is deleted
 * at the end.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { D1Database } from '@cloudflare/workers-types'
import { getPlatformProxy, unstable_splitSqlQuery } from 'wrangler'
import { freshD1 } from '../tests/support/d1.ts'
import * as chat from '../src/features/chat/api/chat-d1.server.ts'
import * as telegram from '../src/features/telegram/telegram-d1.server.ts'
import { purgeRetention } from '../src/features/telegram/retention.ts'
import { checkRateLimitD1 } from '../src/shared/lib/db/rate-limit-d1.server.ts'

const DATABASE = 'baeventos-staging'
const TABLES = ['profiles', 'conversations', 'messages', 'chat_turns', 'telegram_updates', 'product_feedback']
const root = join(import.meta.dirname, '..')
const results: Array<[string, boolean, string]> = []
const check = (name: string, ok: boolean, detail = '') => { results.push([name, ok, detail]) }
async function attempt(name: string, work: () => Promise<string | void>) {
	try { check(name, true, (await work()) ?? '') } catch (error) { check(name, false, error instanceof Error ? error.message.slice(0, 160) : 'failed') }
}

/** A D1 handle that refuses every statement that is not a SELECT, so the remote checks can't write. */
function selectOnly(db: D1Database): D1Database {
	const prepare = (sql: string) => {
		if (!/^\s*SELECT\b/i.test(sql)) throw new Error(`refused non-SELECT on remote staging: ${sql.trim().split(/\s+/)[0]}`)
		return db.prepare(sql)
	}
	return { prepare, batch: (statements: Parameters<D1Database['batch']>[0]) => db.batch(statements) } as unknown as D1Database
}

const dir = mkdtempSync(join(tmpdir(), 'ba-chat-check-'))
const wrangler = (args: string[]) => execFileSync(join(root, 'node_modules/.bin/wrangler'), args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 })
let remoteDispose: (() => Promise<void>) | undefined
let localDispose: (() => Promise<void>) | undefined
try {
	// ---------------------------------------------------------------------------------------------------------------
	// 1. Read paths against remote staging, SELECT only.
	const info = JSON.parse(wrangler(['d1', 'info', DATABASE, '--json', '--config', 'wrangler.staging.jsonc'])) as { uuid: string }
	const config = join(dir, 'wrangler.json')
	writeFileSync(config, JSON.stringify({ name: 'chat-check', compatibility_date: '2026-08-25',
		account_id: /"account_id":\s*"(\w+)"/.exec(readFileSync(join(root, 'wrangler.staging.jsonc'), 'utf8'))![1],
		d1_databases: [{ binding: 'DB', database_name: DATABASE, database_id: info.uuid, remote: true }] }))
	const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: config, persist: false, envFiles: [] })
	remoteDispose = proxy.dispose
	const raw = proxy.env.DB
	const remote = selectOnly(raw)

	const owners = (await raw.prepare('SELECT DISTINCT user_id FROM conversations WHERE user_id IS NOT NULL').all<{ user_id: string }>()).results.map((r) => r.user_id)
	const stranger = crypto.randomUUID()
	await attempt('remote: SELECT-only wrapper refuses writes', async () => {
		let refused = false
		try { await chat.softDeleteConversation(remote, stranger, stranger) } catch { refused = true }
		if (!refused) throw new Error('a write got through')
	})

	let conversations = 0, messages = 0, turns = 0, replies = 0, searchHits = 0
	for (const owner of owners) {
		await attempt('remote: owned readers decode every row', async () => {
			const page = await chat.listConversations(remote, owner, 500, 0)
			if (page.total !== page.conversations.length) throw new Error('list total differs from page')
			conversations += page.total
			for (const item of page.conversations) {
				const full = await chat.getConversation(remote, owner, item.id)
				if (!full || full.user_id !== owner) throw new Error('getConversation lost an owned conversation')
				const own = await chat.getMessages(remote, owner, item.id)
				if (own.length !== full.messages.length) throw new Error('getMessages differs from getConversation')
				messages += own.length
				for (const message of own.filter((m) => m.client_message_id)) {
					if (await chat.findOwnMessageId(remote, owner, item.id, message.client_message_id!) !== message.id) throw new Error('findOwnMessageId mismatch')
				}
				for (const turn of await chat.listTurns(remote, owner, item.id)) {
					turns++
					if (turn.assistant_message_id) {
						if (!await chat.getTurnAssistantMessage(remote, owner, turn)) throw new Error('reply of a completed turn not found')
						replies++
					}
				}
				const word = full.messages.find((m) => m.role === 'user')?.visible_content.split(/\s+/).find((w) => w.length > 3)
				if (word && (await chat.searchConversations(remote, owner, word, 20)).some((r) => r.conversation_id === item.id)) searchHits++
			}
		})
		await attempt('remote: other owners and strangers see none of these rows', async () => {
			const page = await chat.listConversations(remote, owner, 500, 0)
			for (const other of [...owners.filter((o) => o !== owner), stranger]) {
				for (const item of page.conversations) {
					if (await chat.getConversation(remote, other, item.id)) throw new Error('conversation visible to another user')
					if ((await chat.getMessages(remote, other, item.id)).length) throw new Error('messages visible to another user')
					if ((await chat.listTurns(remote, other, item.id)).length) throw new Error('turns visible to another user')
				}
			}
		})
	}
	check('remote: coverage', true, `${owners.length} owners, ${conversations} conversations, ${messages} messages, ${turns} turns, ${replies} replies, search found ${searchHits}`)
	await attempt('remote: soft-deleted conversations stay hidden', async () => {
		const deleted = (await raw.prepare('SELECT id, user_id FROM conversations WHERE deleted_at IS NOT NULL AND user_id IS NOT NULL').all<{ id: string; user_id: string }>()).results
		for (const row of deleted) if (await chat.getConversation(remote, row.user_id, row.id)) throw new Error('deleted conversation returned')
		return `${deleted.length} deleted`
	})

	await attempt('remote: Telegram conversations and claims decode', async () => {
		const external = (await raw.prepare("SELECT id, external_identity_hash FROM conversations WHERE channel = 'telegram' AND user_id IS NULL AND deleted_at IS NULL").all<{ id: string; external_identity_hash: string }>()).results
		let externalMessages = 0
		for (const row of external) {
			if ((await chat.findExternalConversation(remote, 'telegram', row.external_identity_hash))?.id !== row.id) throw new Error('find by hash failed')
			if (!await chat.getExternalConversation(remote, 'telegram', row.id)) throw new Error('getExternalConversation failed')
			externalMessages += (await chat.loadExternalMessages(remote, 'telegram', row.id)).length
			for (const owner of owners) if (await chat.getConversation(remote, owner, row.id)) throw new Error('Telegram conversation visible to a user')
		}
		const updates = (await raw.prepare('SELECT update_id, typeof(update_id) t FROM telegram_updates').all<{ update_id: number; t: string }>()).results
		for (const update of updates) {
			if (update.t !== 'integer') throw new Error('update_id is not an integer')
			const claim = await telegram.readClaim(remote, String(update.update_id))
			if (!claim || typeof claim.attempt_count !== 'number') throw new Error('readClaim failed')
		}
		const stale = await telegram.countStaleFailures(remote, new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
		return `${external.length} conversations, ${externalMessages} messages, ${updates.length} claims, ${stale} stale failures`
	})

	await attempt('remote: stored shapes match the writers’ assumptions', async () => {
		const bad = await raw.prepare(`SELECT
			(SELECT count(*) FROM messages WHERE json_type(execution_trace) <> 'array') AS traces,
			(SELECT count(*) FROM messages WHERE attached_data IS NOT NULL AND json_type(attached_data) <> 'object') AS attached,
			(SELECT count(*) FROM conversations WHERE metadata IS NOT NULL AND json_type(metadata) <> 'object') AS metadata,
			(SELECT count(*) FROM messages m WHERE NOT EXISTS (SELECT 1 FROM conversations c WHERE c.id = m.conversation_id)) AS orphans,
			(SELECT count(*) FROM chat_turns t JOIN conversations c ON c.id = t.conversation_id WHERE c.user_id IS NOT t.user_id) AS turn_owner,
			(SELECT count(*) FROM (SELECT conversation_id, sequence_number FROM messages GROUP BY 1, 2 HAVING count(*) > 1)) AS duplicate_sequence,
			(SELECT count(*) FROM product_feedback WHERE length(message) NOT BETWEEN 1 AND 2000) AS feedback`).first<Record<string, number>>()
		const failing = Object.entries(bad ?? {}).filter(([, n]) => n !== 0)
		if (failing.length) throw new Error(`unexpected rows: ${failing.map(([k, n]) => `${k}=${n}`).join(', ')}`)
		return 'traces, attached data, metadata, ownership, sequences, feedback length all as assumed'
	})

	// ---------------------------------------------------------------------------------------------------------------
	// 2. Write paths on a local copy of staging's chat tables.
	const dump = join(dir, 'chat.sql')
	wrangler(['d1', 'export', DATABASE, '--remote', '--no-schema', ...TABLES.flatMap((t) => ['--table', t]), '--output', dump, '--config', 'wrangler.staging.jsonc'])
	const local = await freshD1()
	localDispose = local.dispose
	const db = local.db
	const inserts = unstable_splitSqlQuery(readFileSync(dump, 'utf8')).filter((sql) => /^INSERT/i.test(sql.trim()))
	await db.batch([db.prepare('PRAGMA defer_foreign_keys = ON'), ...inserts.map((sql) => db.prepare(sql))])
	check('local: copy loaded', true, `${inserts.length} rows from ${TABLES.length} tables`)

	await attempt('local: claim, complete, replay, and fail each copied turn', async () => {
		const rows = (await db.prepare('SELECT id, user_id, assistant_client_message_id, status FROM chat_turns').all<{ id: string; user_id: string; assistant_client_message_id: string; status: string }>()).results
		let completed = 0, refused = 0
		for (const row of rows) {
			const claimId = crypto.randomUUID()
			const turn = await chat.claimTurn(db, row.user_id, row.id, claimId, true)
			const input = { turnId: row.id, claimId, assistantClientMessageId: row.assistant_client_message_id, content: 'check', attachedData: {}, executionTrace: [] }
			if (turn.claim_id !== claimId) {
				// Completed turns keep their claim: a stale completion must be refused and change nothing.
				await chat.completeTurn(db, row.user_id, input).then(() => { throw new Error('stale completion accepted') }, () => refused++)
				continue
			}
			const done = await chat.completeTurn(db, row.user_id, input)
			const again = await chat.completeTurn(db, row.user_id, { ...input, content: 'overwrite' })
			if (done.status !== 'completed' || again.assistant_message_id !== done.assistant_message_id) throw new Error('completion not idempotent')
			const reply = await chat.getTurnAssistantMessage(db, row.user_id, done)
			const parent = await db.prepare('SELECT turn_index FROM messages WHERE id = (SELECT user_message_id FROM chat_turns WHERE id = ?)').bind(row.id).first<number>('turn_index')
			if (reply?.turn_index !== parent) throw new Error('reply not in its user message’s turn')
			await chat.failTurn(db, row.user_id, row.id, claimId, 'execution_failed').then(() => { throw new Error('failed a completed turn') }, () => undefined)
			completed++
		}
		return `${rows.length} turns: ${completed} completed on a fresh claim, ${refused} already-completed refused a stale claim`
	})

	await attempt('local: messages append after copied history with the next sequence and turn', async () => {
		const rows = (await db.prepare(`SELECT id, user_id FROM conversations WHERE user_id IS NOT NULL AND deleted_at IS NULL`).all<{ id: string; user_id: string }>()).results
		for (const row of rows) {
			const before = await db.prepare('SELECT coalesce(max(sequence_number), -1) s, coalesce(max(turn_index), -1) t FROM messages WHERE conversation_id = ?').bind(row.id).first<{ s: number; t: number }>()
			const user = await chat.insertMessage(db, { userId: row.user_id }, { conversationId: row.id, role: 'user', content: 'check', responseContractVersion: 5, clientMessageId: crypto.randomUUID() })
			const reply = await chat.insertMessage(db, { userId: row.user_id }, { conversationId: row.id, role: 'assistant', content: 'check', responseContractVersion: 5, clientMessageId: crypto.randomUUID() })
			if (user.sequence_number !== before!.s + 1 || user.turn_index !== before!.t + 1) throw new Error('user message numbering')
			if (reply.parent_id !== user.id || reply.turn_index !== user.turn_index) throw new Error('assistant parenting')
			const other = owners.find((o) => o !== row.user_id) ?? crypto.randomUUID()
			await chat.insertMessage(db, { userId: other }, { conversationId: row.id, role: 'user', content: 'x', responseContractVersion: 5 })
				.then(() => { throw new Error('wrote into another user’s conversation') }, () => undefined)
			await chat.updateConversation(db, other, row.id, { title: 'x' }).then(() => { throw new Error('renamed another user’s conversation') }, () => undefined)
			// A whole new turn on the copied history: bootstrap, claim, complete, and a stale claim refused.
			const turnInput = { conversationId: row.id, turnId: crypto.randomUUID(), userClientMessageId: crypto.randomUUID(),
				assistantClientMessageId: crypto.randomUUID(), content: 'check', locale: 'en' as const }
			const fresh = await chat.bootstrapTurn(db, row.user_id, turnInput)
			const claimId = crypto.randomUUID()
			await chat.claimTurn(db, row.user_id, fresh.id, claimId, false)
			const done = await chat.completeTurn(db, row.user_id, { turnId: fresh.id, claimId, assistantClientMessageId: turnInput.assistantClientMessageId,
				content: 'check', attachedData: {}, executionTrace: [] })
			const freshReply = await chat.getTurnAssistantMessage(db, row.user_id, done)
			if (done.status !== 'completed' || freshReply?.parent_id !== fresh.user_message_id) throw new Error('fresh turn on copied history')
			await chat.bootstrapTurn(db, other, { ...turnInput, turnId: crypto.randomUUID(), userClientMessageId: crypto.randomUUID() })
				.then(() => { throw new Error('bootstrapped into another user’s conversation') }, () => undefined)
			const renamed = await chat.updateConversation(db, row.user_id, row.id, { title: 'Checked' })
			if (renamed.title !== 'Checked') throw new Error('rename')
		}
		return `${rows.length} conversations: 2 messages and 1 full turn appended to each, other-user writes refused`
	})

	await attempt('local: Telegram claims, retention, and feedback on copied rows', async () => {
		const now = new Date().toISOString()
		const claims = (await db.prepare('SELECT update_id, identity_hash, status FROM telegram_updates').all<{ update_id: number; identity_hash: string | null; status: string }>()).results
		for (const claim of claims) {
			const id = String(claim.update_id)
			if (await telegram.insertClaim(db, id, 'f'.repeat(64), `${'A'.repeat(43)}=`, now)) throw new Error('duplicate claim inserted')
			if (claim.identity_hash && claim.status !== 'completed') await telegram.renewClaim(db, id, claim.identity_hash, now)
			await telegram.markCompleted(db, id, null, now)
			if ((await telegram.readClaim(db, id))?.status !== 'completed') throw new Error('markCompleted')
		}
		const purged = await purgeRetention(db, now)
		await db.prepare('INSERT INTO product_feedback (id, user_id, message) VALUES (?, ?, ?)').bind(crypto.randomUUID(), owners[0] ?? null, 'check').run()
		await db.prepare('INSERT INTO product_feedback (id, user_id, message) VALUES (?, NULL, ?)').bind(crypto.randomUUID(), 'check').run()
		const limit = await checkRateLimitD1(db, 'chat', 'f'.repeat(64), 50, 3600)
		if (!limit.success) throw new Error('rate limit')
		return `${claims.length} claims completed, retention would purge ${purged.conversations} conversations and ${purged.updates} claims older than now, feedback and rate limit written`
	})
} finally {
	await localDispose?.().catch(() => {})
	await remoteDispose?.().catch(() => {})
	rmSync(dir, { recursive: true, force: true })
}

for (const [name, ok, detail] of results) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
process.exit(results.every(([, ok]) => ok) ? 0 : 1)
