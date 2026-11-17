/**
 * Production binds no D1 until the cutover (DECISIONS.md), so without a `DB` binding every account path must keep the
 * Supabase behavior it had before Better Auth: Supabase Auth sessions, the service-role delete (now only of the session user), no /api/auth or
 * /api/saved, and the user-tools reads through the cookie-bound Supabase client.
 */
import { Effect } from 'effect'
import type { RequestEvent } from '@sveltejs/kit'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const deleteUser = vi.fn(async (_id: string) => ({ error: null }))
const signedIn = { data: { user: { id: 'supabase-user', email: 'user@example.test' } as { id: string; email: string } | null }, error: null }
const getUser = vi.fn(async () => signedIn)
const savedQuery = { select: () => savedQuery, eq: () => savedQuery, in: () => savedQuery, limit: () => savedQuery,
	abortSignal: () => savedQuery, then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: [{ event_id: 'e1' }], error: null })) }
const profileQuery = { select: () => profileQuery, eq: () => profileQuery, single: async () => ({ data: { id: 'supabase-user', role: 'admin' }, error: null }) }
const from = vi.fn((table: string) => (table === 'saved_events' ? savedQuery : profileQuery))

vi.mock('#shared/lib/db/service.server.ts', () => ({ getSupabaseServiceRoleClient: () => ({ auth: { admin: { deleteUser } } }) }))
vi.mock('#shared/lib/db/server-client.server.ts', () => ({ createSupabaseServerClient: () => ({ auth: { getUser }, from }) }))

const { deleteAccountEffect } = await import('./server.server.ts')
const { getSessionUser } = await import('./session.server.ts')
const { getSavedMembershipForIds } = await import('#features/chat/api/user-tools.server.ts')
const authRoute = await import('../../../routes/api/auth/[...path]/+server.ts')
const savedRoute = await import('../../../routes/api/saved/+server.ts')

const productionEvent = (path = '/') => ({
	url: new URL(path, 'https://baeventos.com'), platform: { env: { EMAIL: {} } },
	request: new Request(new URL(path, 'https://baeventos.com')), cookies: { get: () => undefined, getAll: () => [], set: () => {} },
}) as unknown as RequestEvent

beforeEach(() => { deleteUser.mockClear(); from.mockClear(); getUser.mockClear() })

describe('a Worker without D1 (production until the cutover)', () => {
	it('reads the session from Supabase Auth, with the admin role from profiles', async () => {
		expect(await getSessionUser(productionEvent())).toMatchObject({ user: { id: 'supabase-user' }, isAdmin: true })
	})

	it('deletes the signed-in user through the Supabase admin API', async () => {
		await Effect.runPromise(deleteAccountEffect(productionEvent(), { userId: 'supabase-user' }))
		expect(deleteUser).toHaveBeenCalledTimes(1)
		expect(deleteUser).toHaveBeenCalledWith('supabase-user')
	})

	it('refuses to delete when nobody is signed in, without an admin call', async () => {
		getUser.mockResolvedValueOnce({ data: { user: null }, error: null })
		await expect(Effect.runPromise(deleteAccountEffect(productionEvent(), { userId: 'supabase-user' })))
			.rejects.toThrow('Must be logged in to delete your account')
		expect(deleteUser).not.toHaveBeenCalled()
	})

	it("refuses to delete another user's account, without an admin call", async () => {
		await expect(Effect.runPromise(deleteAccountEffect(productionEvent(), { userId: 'someone-else' })))
			.rejects.toThrow('Account changed during deletion')
		expect(deleteUser).not.toHaveBeenCalled()
	})

	it('has no Better Auth or /api/saved routes', async () => {
		await expect(authRoute.GET(productionEvent('/api/auth/get-session') as never)).rejects.toMatchObject({ status: 404 })
		await expect(savedRoute.GET(productionEvent('/api/saved') as never)).rejects.toMatchObject({ status: 404 })
		await expect(savedRoute.POST(productionEvent('/api/saved') as never)).rejects.toMatchObject({ status: 404 })
	})

	it('reads saved membership for chat through the cookie-bound Supabase client', async () => {
		const result = await getSavedMembershipForIds({ userId: 'supabase-user', isAuthenticated: true, event: productionEvent() }, ['e1'])
		expect(result).toEqual({ status: 'complete', savedIds: new Set(['e1']) })
		expect(from).toHaveBeenCalledWith('saved_events')
	})
})
