import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getConversation } from './conversations.server.ts'
import { createSupabaseServerClient } from '#shared/lib/db/server-client.server.ts'

vi.mock('#shared/lib/db/server-client.server.ts', () => ({
  createSupabaseServerClient: vi.fn(),
}))

const user = { id: 'user-1' } as never

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
