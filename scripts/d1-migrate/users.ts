/**
 * The Better Auth part of the copy: Supabase's auth users → D1 `users` and `accounts`, keeping each Supabase UUID as
 * the Better Auth user id so `profiles`, `saved_events`, `user_preferences` and `conversations` stay attached.
 *
 * Each user gets one `email` account row (the magic-link sign-in). Google is not imported: Supabase's admin API gives
 * no Google subject, so the user who also used Google is linked by verified email the first time they sign in with it
 * (`accountLinking.trustedProviders: ['google']`). Sessions are not copied; everyone signs in once after the cutover.
 *
 * load.ts runs this after the tables, so every profile already exists; verify.ts checks the result with `checkUsers`.
 */
import type { D1Database } from '@cloudflare/workers-types'

export type AuthUser = { id: string; email: string | null; email_verified?: boolean }

/** The import's statements for these users. Throws, writing nothing, if a user has no email or no profile. */
export function userRows(users: readonly AuthUser[], profileIds: ReadonlySet<string>, now = new Date().toISOString()) {
	const problems = users.flatMap((u) => [
		...(u.email ? [] : [`auth user ${u.id} has no email`]),
		...(profileIds.has(u.id) ? [] : [`auth user ${u.id} has no profile`]),
	])
	if (problems.length) throw new Error(`Cannot import users: ${problems.join('; ')}`)
	return users.map((u) => ({
		user: [u.id, u.email!.toLowerCase(), u.email_verified === false ? 0 : 1, now, now] as const,
		// account_id = user id, as Better Auth's own local accounts; issuer `local:email` is its local-account namespace.
		account: [crypto.randomUUID(), u.id, u.id, 'email', 'local:email', now, now] as const,
	}))
}

/** Replaces every Better Auth row in `db` with the imported users, in one transaction. */
export async function importUsers(db: D1Database, users: readonly AuthUser[]): Promise<number> {
	const profileIds = new Set((await db.prepare('SELECT id FROM profiles').all<{ id: string }>()).results.map((r) => r.id))
	const rows = userRows(users, profileIds)
	// Deleting a user fires users_delete_profile, so imported users are upserted, never deleted and re-inserted; only
	// users missing from the export (and so from the copied profiles) are deleted.
	await db.batch([
		db.prepare('DELETE FROM sessions'),
		db.prepare('DELETE FROM accounts'),
		db.prepare('DELETE FROM verification_tokens'),
		db.prepare('DELETE FROM auth_rate_limits'),
		db.prepare('DELETE FROM users WHERE id NOT IN (SELECT value FROM json_each(?))').bind(JSON.stringify(users.map((u) => u.id))),
		...rows.map(({ user }) => db.prepare(`INSERT INTO users (id, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
			ON CONFLICT (id) DO UPDATE SET email = excluded.email, email_verified = excluded.email_verified`).bind(...user)),
		...rows.map(({ account }) => db.prepare(`INSERT INTO accounts (id, user_id, account_id, provider_id, issuer, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(...account)),
	])
	return rows.length
}

/** Mismatches between the export's auth users and the D1 users and email accounts. */
export async function checkUsers(db: D1Database, users: readonly AuthUser[]): Promise<string[]> {
	const { results } = await db.prepare(`SELECT u.id, u.email, p.id AS profile, (SELECT count(*) FROM accounts a WHERE a.user_id = u.id AND a.provider_id = 'email') AS email_accounts
		FROM users u LEFT JOIN profiles p ON p.id = u.id`).all<{ id: string; email: string; profile: string | null; email_accounts: number }>()
	const byId = new Map(results.map((r) => [r.id, r]))
	const problems: string[] = []
	for (const u of users) {
		const row = byId.get(u.id)
		if (!row) problems.push(`user ${u.id} is missing`)
		else if (row.email !== u.email?.toLowerCase() || !row.profile || row.email_accounts !== 1) problems.push(`user ${u.id} differs`)
	}
	if (results.length !== users.length) problems.push(`D1 has ${results.length} users, the export ${users.length}`)
	return problems
}
