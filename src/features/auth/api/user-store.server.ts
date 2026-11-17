/**
 * The signed-in user's own rows on D1: profile, saved events, and account deletion. Callers pass the user id from the
 * server session (never from the request body), and every statement filters by it, because D1 has no row-level
 * security. Only a Worker that binds `DB` uses this (the staging Worker until the cutover); production keeps its
 * Supabase paths, where RLS does this job.
 */
import type { D1Database } from '@cloudflare/workers-types'
import { Schema } from 'effect'
import type { Locale, Profile, SavedEventWithDetails } from '#shared/lib/types.ts'
import { EVENT_COLUMNS, toPayload } from '#shared/lib/db/search-d1.server.ts'

export type ProfilePatch = { display_name?: string; locale?: Locale }
export type SaveResult = 'saved' | 'event_not_found'

export interface UserStore {
	profile(userId: string): Promise<Profile | null>
	updateProfile(userId: string, patch: ProfilePatch): Promise<void>
	/** Newest first, each with the time it was saved. */
	savedEvents(userId: string): Promise<SavedEventWithDetails[]>
	/** Which of `eventIds` the user saved. */
	savedMembership(userId: string, eventIds: readonly string[]): Promise<Set<string>>
	/** Saving twice keeps one row. Only scheduled and past events can be saved, as the spec requires. */
	save(userId: string, eventId: string): Promise<SaveResult>
	unsave(userId: string, eventId: string): Promise<void>
	deleteAccount(userId: string): Promise<void>
}

/** Ids are compared as text; keep the membership query bounded. */
export const MAX_MEMBERSHIP_IDS = 100

const D1Profile = Schema.Struct({
	id: Schema.String, email: Schema.String, display_name: Schema.NullOr(Schema.String),
	role: Schema.Literals(['admin', 'user']), locale: Schema.NullOr(Schema.Literals(['es', 'en'])),
	created_at: Schema.String, updated_at: Schema.String,
})
const decodeProfile = Schema.decodeUnknownSync(D1Profile)

export function d1UserStore(db: D1Database): UserStore {
	return {
		async profile(userId) {
			const row = await db.prepare('SELECT id, email, display_name, role, locale, created_at, updated_at FROM profiles WHERE id = ?').bind(userId).first()
			return row ? decodeProfile(row) : null
		},
		async updateProfile(userId, patch) {
			await db.prepare(`UPDATE profiles SET display_name = coalesce(?, display_name), locale = coalesce(?, locale),
				updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`).bind(patch.display_name ?? null, patch.locale ?? null, userId).run()
		},
		async savedEvents(userId) {
			const { results } = await db.prepare(`SELECT ${EVENT_COLUMNS}, s.created_at AS saved_at
				FROM saved_events s JOIN events e ON e.id = s.event_id LEFT JOIN venues v ON v.id = e.venue_id
				WHERE s.user_id = ? ORDER BY s.created_at DESC`)
				.bind(userId).all<{ saved_at: string }>()
			return results.map((row) => ({ ...toPayload(row), saved_at: row.saved_at }) as unknown as SavedEventWithDetails)
		},
		async savedMembership(userId, eventIds) {
			if (eventIds.length === 0) return new Set()
			const { results } = await db.prepare('SELECT event_id FROM saved_events WHERE user_id = ? AND event_id IN (SELECT value FROM json_each(?))')
				.bind(userId, JSON.stringify(eventIds)).all<{ event_id: string }>()
			return new Set(results.map((r) => r.event_id))
		},
		async save(userId, eventId) {
			const [, saved] = await db.batch([
				db.prepare(`INSERT INTO saved_events (id, user_id, event_id) SELECT ?, ?, id FROM events WHERE id = ? AND status IN ('scheduled', 'past')
					ON CONFLICT (user_id, event_id) DO NOTHING`).bind(crypto.randomUUID(), userId, eventId),
				db.prepare('SELECT 1 AS saved FROM saved_events WHERE user_id = ? AND event_id = ?').bind(userId, eventId),
			])
			return saved!.results.length ? 'saved' : 'event_not_found'
		},
		async unsave(userId, eventId) {
			await db.prepare('DELETE FROM saved_events WHERE user_id = ? AND event_id = ?').bind(userId, eventId).run()
		},
		async deleteAccount(userId) {
			// users_delete_profile deletes the profile, which cascades to saved events, preferences and conversations.
			await db.prepare('DELETE FROM users WHERE id = ?').bind(userId).run()
		},
	}
}
