import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createConversation, getConversation } from './conversations.server.ts'
import { createSupabaseServerClient } from '#shared/lib/db/server-client.server.ts'

vi.mock('#shared/lib/db/server-client.server.ts', () => ({
  createSupabaseServerClient: vi.fn(),
}))

const authenticatedUserId = 'user-1'
const user = { id: authenticatedUserId } as never

function requestEvent() {
  const conversations = {
    select: () => conversations,
    eq: () => conversations,
    is: () => conversations,
    single: async () => ({
      data: { id: 'conversation-1', user_id: 'user-1' },
      error: null,
    }),
  }
  const messages = {
    select: () => messages,
    eq: () => messages,
    order: () => messages,
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(resolve({ data: [], error: null })),
  }
  const event = {
    locals: { user },
    cookies: {} as never,
  } as never
  vi.mocked(createSupabaseServerClient).mockReturnValue({
    auth: { getUser: vi.fn(() => { throw new Error('duplicate auth lookup') }) },
    from: (table: string) => (table === 'conversations' ? conversations : messages),
  } as never)
  return event
}

describe('createConversation idempotency', () => {
	function createEvent(insertResult: { data: unknown; error: unknown }, existingResult?: unknown) {
		const makeQuery = (result: unknown) => {
			const query = {
				select: () => query,
				eq: () => query,
				is: () => query,
				insert: () => query,
				single: async () => result,
				maybeSingle: async () => ({
					data: existingResult && (existingResult as { user_id?: string }).user_id === authenticatedUserId
						? existingResult
						: null,
					error: null
				})
			}
			return query
		}
		const event = { locals: { user }, cookies: {} as never } as never
		vi.mocked(createSupabaseServerClient).mockReturnValue({
			auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })) },
			from: () => makeQuery(insertResult)
		} as never)
		return event
	}

	beforeEach(() => vi.clearAllMocks())

	it('rejects malformed client conversation IDs before database access', async () => {
		await expect(
			createConversation(createEvent({ data: null, error: null }), { id: 'not-a-uuid' })
		).rejects.toThrow('Failed to create conversation')
		expect(createSupabaseServerClient).not.toHaveBeenCalled()
	})

	it('returns the exact existing conversation on a same-owner retry', async () => {
		const existing = {
			id: '00000000-0000-4000-8000-000000000001',
			user_id: authenticatedUserId
		}
		await expect(
			createConversation(
				createEvent({ data: null, error: { code: '23505' } }, existing),
				{ id: existing.id }
			)
		).resolves.toEqual(existing)
	})

	it('does not reveal or claim a UUID owned by another user', async () => {
		await expect(
			createConversation(
				createEvent({ data: null, error: { code: '23505' } }),
				{ id: '00000000-0000-4000-8000-000000000001', user_id: 'other-user' }
			)
		).rejects.toThrow('Failed to create conversation')
	})
})

describe('getConversation on the signed-in chat route', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses the authenticated request local without another auth lookup', async () => {
    const event = requestEvent()

    await expect(getConversation(event, { id: 'conversation-1' })).resolves.toMatchObject({
      id: 'conversation-1',
      messages: [],
    })

    expect(createSupabaseServerClient(event).auth.getUser).not.toHaveBeenCalled()
  })
})
