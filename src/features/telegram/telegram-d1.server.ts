/**
 * Telegram's `telegram_updates` claims, retention, and health on D1 (delivery PR 05). Same rules as the Supabase
 * statements in delivery.server.ts, retention.ts, and health.ts. The table is service-only: no user ever reads it.
 */
import type { D1Database } from '@cloudflare/workers-types'

type ClaimRow = { status: string; attempt_count: number; identity_hash: string | null; envelope_key: string | null }

/** Inserts a new claim; returns null when the update already has one. */
export async function insertClaim(db: D1Database, updateId: string, identityHash: string, envelopeKey: string, now: string) {
	const row = await db.prepare(`INSERT INTO telegram_updates (update_id, status, identity_hash, envelope_key, received_at, updated_at)
			VALUES (?, 'processing', ?, ?, ?, ?) ON CONFLICT (update_id) DO NOTHING RETURNING update_id`)
		.bind(Number(updateId), identityHash, envelopeKey, now, now).first()
	return row !== null
}

export function readClaim(db: D1Database, updateId: string) {
	return db.prepare('SELECT status, attempt_count, identity_hash, envelope_key FROM telegram_updates WHERE update_id = ?')
		.bind(Number(updateId)).first<ClaimRow>()
}

/** Renews a claim held by the same identity, unless it completed meanwhile. */
export async function renewClaim(db: D1Database, updateId: string, identityHash: string, now: string) {
	await db.prepare(`UPDATE telegram_updates SET status = 'processing', attempt_count = attempt_count + 1, error_code = NULL, updated_at = ?
			WHERE update_id = ? AND identity_hash = ? AND status <> 'completed'`)
		.bind(now, Number(updateId), identityHash).run()
}

export async function attachConversation(db: D1Database, updateId: string, identityHash: string, conversationId: string, now: string) {
	const row = await db.prepare(`UPDATE telegram_updates SET conversation_id = ?, updated_at = ?
			WHERE update_id = ? AND identity_hash = ? AND status <> 'completed' RETURNING update_id`)
		.bind(conversationId, now, Number(updateId), identityHash).first()
	return row !== null
}

export async function markCompleted(db: D1Database, updateId: string, conversationId: string | null, now: string) {
	await db.prepare(`UPDATE telegram_updates SET status = 'completed', conversation_id = ?, envelope_key = NULL, error_code = NULL,
			completed_at = ?, updated_at = ? WHERE update_id = ? AND status <> 'completed'`)
		.bind(conversationId, now, now, Number(updateId)).run()
}

export async function markFailed(db: D1Database, updateId: string, errorCode: string, now: string) {
	await db.prepare(`UPDATE telegram_updates SET status = 'failed', error_code = ?, updated_at = ? WHERE update_id = ? AND status <> 'completed'`)
		.bind(errorCode.slice(0, 64), now, Number(updateId)).run()
}

export async function redactIdentity(db: D1Database, identityHash: string, now: string) {
	await db.prepare(`UPDATE telegram_updates SET status = 'completed', conversation_id = NULL, identity_hash = NULL, envelope_key = NULL,
			error_code = 'identity_redacted', completed_at = ?, updated_at = ? WHERE identity_hash = ?`)
		.bind(now, now, identityHash).run()
}

/** Deletes Telegram conversations and update claims older than the cutoff, in one transaction. */
export async function purgeRetention(db: D1Database, cutoff: string) {
	// RETURNING, not meta.changes: D1's change count also includes the ON DELETE SET NULL updates to telegram_updates.
	const [conversations, updates] = await db.batch([
		db.prepare(`DELETE FROM conversations WHERE channel = 'telegram' AND created_at < ? RETURNING id`).bind(cutoff),
		db.prepare('DELETE FROM telegram_updates WHERE received_at < ? RETURNING update_id').bind(cutoff),
	])
	return { conversations: conversations.results.length, updates: updates.results.length }
}

export async function countStaleFailures(db: D1Database, cutoff: string) {
	return (await db.prepare(`SELECT count(*) AS n FROM telegram_updates WHERE status = 'failed' AND updated_at < ?`)
		.bind(cutoff).first<number>('n')) ?? 0
}
