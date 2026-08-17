import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { CHAT_CONTRACT_VERSION } from '#shared/lib/types.ts'
import {
  addGuestMessage,
  createGuestConversation,
  deleteGuestConversation,
  getGuestConversation,
  getGuestConversationWithMessages,
  listGuestConversations,
  setGuestConversationTitle,
  touchGuestConversation,
} from './guest-conversations.ts'

describe('guest-conversations store', () => {
  beforeEach(async () => {
    // Reset the IndexedDB database between tests.
    indexedDB.deleteDatabase('ba-events-guest-conversations')
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase('ba-events-guest-conversations')
      request.onsuccess = () => resolve(undefined)
      request.onerror = () => resolve(undefined)
    })
  })

  it('creates and retrieves a conversation', async () => {
    await createGuestConversation('conv-1', 'Night out')
    const conversation = await getGuestConversation('conv-1')
    expect(conversation?.id).toBe('conv-1')
    expect(conversation?.title).toBe('Night out')
  })

  it('lists conversations most-recently-updated first', async () => {
    await createGuestConversation('conv-a')
    await createGuestConversation('conv-b')
    await new Promise((r) => setTimeout(r, 5))
    await touchGuestConversation('conv-a')

    const conversations = await listGuestConversations()
    expect(conversations.map((c) => c.id)).toEqual(['conv-a', 'conv-b'])
  })

  it('stores messages in insertion order and joins them with the conversation', async () => {
    await createGuestConversation('conv-1')
    await addGuestMessage('conv-1', {
      id: 'm1',
      clientMessageId: 'm1',
      role: 'user',
      content: 'hi',
    })
    await new Promise((r) => setTimeout(r, 5))
    await addGuestMessage('conv-1', {
      id: 'm2',
      clientMessageId: 'm2',
      role: 'assistant',
      content: 'hello',
      parentMessageId: 'm1',
      attachedData: { events: [] as never },
    })

    const result = await getGuestConversationWithMessages('conv-1')
    expect(result?.conversation.id).toBe('conv-1')
    expect(result?.messages.map((message) => message.id)).toEqual(['m1', 'm2'])
    expect(result?.messages[1].parent_message_id).toBe('m1')
    expect(result?.messages[1].attached_data).toEqual({ events: [] })
  })

  it('preserves response contract v4 and canonical verbatim on reload', async () => {
    await createGuestConversation('conv-1')
    const canonical = {
      contractVersion: 4,
      requestId: 'req-1',
      kind: 'recommendations',
      messageKey: 'recommendations',
      text: 'Here are the best matches I found.',
      events: [{ id: 'e1', name: 'Tango night', saved: null }],
      directions: null,
      venue: null,
      operations: [],
      suggestions: [],
      clarificationQuestions: [],
      provenance: {
        sourceToolCallIds: ['src-1'],
        directionToolCallIds: [],
        venueToolCallIds: [],
        mutationToolCallIds: [],
        suggestionToolCallIds: [],
        emptySourceToolCallIds: [],
        retainedSourceToolCallIds: [],
        stageIds: [],
        searchAttemptToolCallIds: [],
        origin: 'validated',
        fallbackUsed: false,
        fallbackReason: null,
      },
    }
    await addGuestMessage('conv-1', {
      id: 'm1',
      clientMessageId: 'm1',
      role: 'assistant',
      content: canonical.text,
      attachedData: { canonical },
      responseContractVersion: 4,
    })

    const result = await getGuestConversationWithMessages('conv-1')
    const stored = result?.messages[0]
    expect(stored?.response_contract_version).toBe(4)
    // The v4 canonical is stored verbatim (deep equality) and reloads unchanged.
    expect(stored?.attached_data.canonical).toEqual(canonical)
  })

  it('defaults response_contract_version to v4 when omitted', async () => {
    await createGuestConversation('conv-1')
    await addGuestMessage('conv-1', {
      id: 'm1',
      clientMessageId: 'm1',
      role: 'user',
      content: 'hi',
    })

    const result = await getGuestConversationWithMessages('conv-1')
    expect(result?.messages[0].response_contract_version).toBe(CHAT_CONTRACT_VERSION)
  })

  it('returns null for a missing conversation', async () => {
    expect(await getGuestConversationWithMessages('missing')).toBeNull()
  })

  it('updates the title', async () => {
    await createGuestConversation('conv-1')
    await setGuestConversationTitle('conv-1', 'New title')
    expect((await getGuestConversation('conv-1'))?.title).toBe('New title')
  })

  it('deletes a conversation and its messages', async () => {
    await createGuestConversation('conv-1')
    await addGuestMessage('conv-1', {
      id: 'm1',
      clientMessageId: 'm1',
      role: 'user',
      content: 'hi',
    })

    await deleteGuestConversation('conv-1')

    expect(await getGuestConversation('conv-1')).toBeUndefined()
    expect(await getGuestConversationWithMessages('conv-1')).toBeNull()
  })
})
