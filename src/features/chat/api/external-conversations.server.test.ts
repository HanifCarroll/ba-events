import { describe, expect, it, vi } from 'vitest'
import {
  clearExternalConversationMessages,
  getOrCreateExternalConversation,
  hardDeleteExternalConversation,
  insertExternalConversationMessage,
  loadExternalConversationMessages,
  updateExternalConversationMetadata,
} from './external-conversations.server.ts'

const conversation = {
  id: 'conversation-1',
  channel: 'telegram',
  title: 'New conversation',
  created_at: '2026-08-23T00:00:00Z',
  updated_at: '2026-08-23T00:00:00Z',
  metadata: {},
}

function chain(terminal: Record<string, unknown> = {}) {
  const query: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'is', 'order', 'limit', 'update', 'delete', 'insert']) {
    query[method] = vi.fn(() => query)
  }
  query.maybeSingle = vi.fn(async () => terminal.maybeSingle)
  query.single = vi.fn(async () => terminal.single)
  query.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(resolve(terminal.awaited))
  return query
}

describe('external conversation repository', () => {
  it('accepts only an already-computed identity hash when creating a channel conversation', async () => {
    const lookup = chain({ maybeSingle: { data: null, error: null } })
    const created = chain({ single: { data: conversation, error: null } })
    const insert = vi.fn((_payload: Record<string, unknown>) => created)
    const client = {
      from: vi.fn(() => ({ ...lookup, insert })),
    } as never

    await expect(
      getOrCreateExternalConversation(
        {
          channel: 'telegram',
          externalIdentityHash: 'a'.repeat(64),
        },
        client
      )
    ).resolves.toEqual(conversation)

    const payload = insert.mock.calls[0][0]
    expect(payload).toMatchObject({ user_id: null, channel: 'telegram' })
    expect(payload.external_identity_hash).toBe('a'.repeat(64))
  })

  it('scopes an idempotent RPC insert to an external conversation', async () => {
    const conversations = chain({ maybeSingle: { data: { id: conversation.id }, error: null } })
    const message = {
      id: 'message-1',
      conversation_id: conversation.id,
      client_message_id: 'telegram:update:42:user',
      role: 'user',
    }
    const rpc = vi.fn().mockResolvedValue({ data: message, error: null })
    const client = { from: vi.fn(() => conversations), rpc } as never

    await expect(
      insertExternalConversationMessage(
        {
          channel: 'telegram',
          conversationId: conversation.id,
          clientMessageId: 'telegram:update:42:user',
          role: 'user',
          content: 'hola',
        },
        client
      )
    ).resolves.toBe(message)

    expect(rpc).toHaveBeenCalledWith('insert_message_with_turn', {
      p_conversation_id: conversation.id,
      p_parent_id: null,
      p_client_message_id: 'telegram:update:42:user',
      p_role: 'user',
      p_content: 'hola',
      p_visible_content: 'hola',
      p_execution_trace: [],
      p_response_contract_version: 5,
      p_attached_data: {},
    })
  })

  it('bounds recent messages and restores deterministic turn order', async () => {
    const authConversation = chain({ maybeSingle: { data: { id: conversation.id }, error: null } })
    const messages = chain({
      awaited: {
        data: [
          { id: 'assistant', role: 'assistant', turn_index: 0 },
          { id: 'user', role: 'user', turn_index: 0 },
        ],
        error: null,
      },
    })
    const tables = vi.fn((table: string) =>
      table === 'conversations' ? authConversation : messages
    )
    const client = { from: tables } as never

    await expect(
      loadExternalConversationMessages(
        { channel: 'telegram', conversationId: conversation.id },
        client
      )
    ).resolves.toMatchObject([{ id: 'user' }, { id: 'assistant' }])
    expect(messages.order).toHaveBeenCalledWith('sequence_number', { ascending: false })
    expect(messages.limit).toHaveBeenCalledWith(120)
  })

  it('merges locale/consent metadata', async () => {
    const metadataRead = chain({
      single: { data: { metadata: { retained: true } }, error: null },
    })
    const updated = chain({
      single: {
        data: { ...conversation, metadata: { retained: true, locale: 'es', consent: true } },
        error: null,
      },
    })
    const update = vi.fn(() => updated)
    let call = 0
    const metadataClient = {
      from: vi.fn(() => {
        call += 1
        if (call === 1) return metadataRead
        return { ...updated, update }
      }),
    } as never

    await updateExternalConversationMetadata(
      {
        channel: 'telegram',
        conversationId: conversation.id,
        metadataPatch: { locale: 'es', consentVersion: 'telegram-v1' },
      },
      metadataClient
    )
    expect(update).toHaveBeenCalledWith({
      metadata: { retained: true, locale: 'es', consentVersion: 'telegram-v1' },
    })
  })

  it('clears messages only after verifying the external conversation', async () => {
    const authConversation = chain({ maybeSingle: { data: { id: conversation.id }, error: null } })
    const messages = chain({ awaited: { error: null } })
    const client = {
      from: vi.fn((table: string) => (table === 'conversations' ? authConversation : messages)),
    } as never

    await clearExternalConversationMessages(
      { channel: 'telegram', conversationId: conversation.id },
      client
    )
    expect(messages.delete).toHaveBeenCalled()
  })

  it('hard-deletes only the null-owner channel conversation', async () => {
    const query = chain({ awaited: { error: null } })
    const client = { from: vi.fn(() => query) } as never

    await hardDeleteExternalConversation(
      { channel: 'telegram', conversationId: conversation.id },
      client
    )

    expect(query.delete).toHaveBeenCalled()
    expect(query.eq).toHaveBeenCalledWith('channel', 'telegram')
    expect(query.is).toHaveBeenCalledWith('user_id', null)
  })
})
