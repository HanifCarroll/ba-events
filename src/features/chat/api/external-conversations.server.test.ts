import type { D1Database } from '@cloudflare/workers-types'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { freshD1 } from '../../../../tests/support/d1.ts'
import { useD1Binding } from '#shared/lib/db/d1-binding.server.ts'
import { EXTERNAL_CHANNEL } from './channels.ts'
import {
  clearExternalConversationMessages, getOrCreateExternalConversation, hardDeleteExternalConversation,
  insertExternalConversationMessage, loadExternalConversationMessages, updateExternalConversationMetadata,
} from './external-conversations.server.ts'

let db: D1Database
let dispose: () => Promise<void>
beforeAll(async () => { ({ db, dispose } = await freshD1()) }, 60_000)
afterAll(async () => { await dispose() })
beforeEach(() => useD1Binding({ DB: db }))
afterEach(() => useD1Binding(undefined))

const channel = EXTERNAL_CHANNEL.telegram

describe('external conversations', () => {
  it('requires a hash and stores only a null-owner external identity', async () => {
    await expect(getOrCreateExternalConversation({ channel, externalIdentityHash: 'raw-id' })).rejects.toMatchObject({
      _tag: 'ExternalConversationError', message: 'Invalid external identity hash',
    })
    const input = { channel, externalIdentityHash: 'a'.repeat(64) }
    const created = await getOrCreateExternalConversation(input)
    expect(await getOrCreateExternalConversation(input)).toEqual(created)
    expect(await db.prepare('SELECT channel, user_id, external_identity_hash FROM conversations WHERE id = ?').bind(created.id).first())
      .toEqual({ channel, user_id: null, external_identity_hash: input.externalIdentityHash })
  })

  it('replays a message, merges metadata and clears only the verified channel', async () => {
    const created = await getOrCreateExternalConversation({ channel, externalIdentityHash: 'b'.repeat(64), metadata: { retained: true } })
    const input = { channel, conversationId: created.id }
    const message = { ...input, role: 'user' as const, clientMessageId: 'external:update:42:user', content: 'hola' }
    const stored = await insertExternalConversationMessage(message)
    expect(await insertExternalConversationMessage(message)).toEqual(stored)
    expect(await loadExternalConversationMessages(input)).toEqual([stored])
    expect(await updateExternalConversationMetadata({ ...input, metadataPatch: { locale: 'es' } }))
      .toMatchObject({ metadata: { retained: true, locale: 'es' } })
    await clearExternalConversationMessages(input)
    expect(await loadExternalConversationMessages(input)).toEqual([])
    await hardDeleteExternalConversation(input)
    expect(await db.prepare('SELECT id FROM conversations WHERE id = ?').bind(created.id).first()).toBeNull()
  })
})
