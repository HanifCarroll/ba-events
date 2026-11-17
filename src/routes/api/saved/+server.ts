import { error, json, type RequestHandler } from '@sveltejs/kit'
import { Schema } from 'effect'
import { platformEnv } from '#features/auth/api/better-auth.server.ts'
import { getSessionUser } from '#features/auth/api/session.server.ts'
import { d1UserStore, MAX_MEMBERSHIP_IDS } from '#features/auth/api/user-store.server.ts'
import { boundD1Database } from '#shared/lib/db/d1.server.ts'

// The signed-in user's saved events on a Worker that binds D1 (the staging Worker until the cutover). Without D1 this
// route doesn't exist: production's browser keeps reading and writing saved events through Supabase with RLS.
// The user always comes from the session. A request may name the user it expects (`expectedUserId` in the query or
// body); if the session now belongs to someone else it gets 409 and changes nothing.
//   GET  /api/saved                  → { events }  newest first
//   GET  /api/saved?ids=a,b          → { savedIds } which of these events the user saved (at most 100)
//   POST /api/saved   { eventId }    → save (saving twice keeps one row)
//   DELETE /api/saved { eventId }    → unsave

const noStore = { 'cache-control': 'private, no-store' }
const body = Schema.decodeUnknownResult(Schema.Struct({
	eventId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
	expectedUserId: Schema.optional(Schema.String),
}))

type Event = Parameters<RequestHandler>[0]

/** The D1 user store, or a 404 on a Worker without D1. */
function storeFor(event: Event) {
	const db = boundD1Database(platformEnv(event))
	if (!db) error(404, 'Not found')
	return d1UserStore(db)
}

/** The session's user id, or the response to send instead. */
async function sessionUser(event: Event, expectedUserId: string | null | undefined): Promise<string | Response> {
	const id = (await getSessionUser(event))?.user.id
	if (!id) return json({ error: 'Not authenticated' }, { status: 401, headers: noStore })
	if (expectedUserId && expectedUserId !== id) return json({ error: 'Account changed' }, { status: 409, headers: noStore })
	return id
}

export const GET: RequestHandler = async (event) => {
	const store = storeFor(event)
	const id = await sessionUser(event, event.url.searchParams.get('expectedUserId'))
	if (id instanceof Response) return id
	const ids = event.url.searchParams.get('ids')
	if (ids !== null) {
		const list = ids.split(',').filter(Boolean)
		if (list.length > MAX_MEMBERSHIP_IDS) return json({ error: `At most ${MAX_MEMBERSHIP_IDS} ids` }, { status: 400, headers: noStore })
		return json({ savedIds: [...await store.savedMembership(id, list)] }, { headers: noStore })
	}
	return json({ events: await store.savedEvents(id) }, { headers: noStore })
}

/** The session user and the event to change, or the response to send instead. */
async function mutation(event: Event): Promise<{ userId: string; eventId: string } | Response> {
	let parsed: ReturnType<typeof body>
	try { parsed = body(await event.request.json()) } catch { parsed = body(null) }
	if (parsed._tag !== 'Success') return json({ error: 'eventId is required' }, { status: 400, headers: noStore })
	const userId = await sessionUser(event, parsed.success.expectedUserId)
	return userId instanceof Response ? userId : { userId, eventId: parsed.success.eventId }
}

export const POST: RequestHandler = async (event) => {
	const store = storeFor(event)
	const input = await mutation(event)
	if (input instanceof Response) return input
	const result = await store.save(input.userId, input.eventId)
	if (result === 'event_not_found') return json({ error: 'Event not found' }, { status: 404, headers: noStore })
	return json({ saved: true }, { headers: noStore })
}

export const DELETE: RequestHandler = async (event) => {
	const store = storeFor(event)
	const input = await mutation(event)
	if (input instanceof Response) return input
	await store.unsave(input.userId, input.eventId)
	return json({ saved: false }, { headers: noStore })
}
