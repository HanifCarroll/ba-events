import type { D1Database } from '@cloudflare/workers-types'
import type { RequestEvent } from '@sveltejs/kit'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { freshD1 } from '../../../../tests/support/d1.ts'
import { useD1Binding } from '#shared/lib/db/d1-binding.server.ts'
import { createConversation, getConversation, listConversations } from './conversations.server.ts'

let db: D1Database
let dispose: () => Promise<void>
beforeAll(async () => {
  ({ db, dispose } = await freshD1())
  await db.exec("INSERT INTO profiles (id, email) VALUES ('alice', 'alice@example.test'), ('bob', 'bob@example.test')")
}, 60_000)
afterAll(async () => { await dispose() })
beforeEach(() => useD1Binding({ DB: db }))
afterEach(() => useD1Binding(undefined))

const event = (id?: string, signal?: AbortSignal) => ({ locals: { user: id ? { id } : null },
  request: new Request('https://example.test', { signal }) }) as RequestEvent

describe('conversation request boundary', () => {
  it('validates invalid client ids before contacting D1', async () => {
    const prepare = vi.fn()
    useD1Binding({ DB: { prepare, batch: vi.fn() } })
    await expect(createConversation(event('alice'), { id: 'not-a-uuid' })).rejects.toThrow('Failed to create conversation')
    expect(prepare).not.toHaveBeenCalled()
  })

  it('replays a client id only for the session user', async () => {
    const id = crypto.randomUUID()
    const created = await createConversation(event('alice'), { id, title: 'First title' })
    expect(await createConversation(event('alice'), { id, title: 'Retry' })).toEqual(created)
    await expect(createConversation(event('bob'), { id })).rejects.toThrow('Failed to create conversation')
    expect(await getConversation(event('bob'), { id })).toBeNull()
    expect(await listConversations(event())).toEqual({ conversations: [], total: 0 })
    expect(await getConversation(event('alice'), { id })).toMatchObject({ id, title: 'First title', messages: [] })
  })

  it('does not dispatch a history read for a canceled request', async () => {
    const batch = vi.fn()
    useD1Binding({ DB: { prepare: vi.fn(), batch } })
    await expect(getConversation(event('alice', AbortSignal.abort()), { id: 'c' })).rejects.toBeDefined()
    expect(batch).not.toHaveBeenCalled()
  })
})
