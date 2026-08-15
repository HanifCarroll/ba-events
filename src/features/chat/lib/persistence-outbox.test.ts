import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { LocalOutboxItem } from '#shared/lib/db/local-outbox.ts'
import {
  flushMessagePersistenceOutbox,
  MAX_OUTBOX_ATTEMPTS,
  persistMessageWithOutbox,
} from './persistence-outbox.ts'
import {
  addOutboxItem,
  deleteOutboxItem,
  getOutboxItemByClientMessageId,
  listDueOutboxItems,
  updateOutboxItem,
} from '#shared/lib/db/local-outbox.ts'

vi.mock('#shared/lib/db/local-outbox.ts', () => ({
  addOutboxItem: vi.fn(),
  deleteOutboxItem: vi.fn(),
  getOutboxItemByClientMessageId: vi.fn(),
  listDueOutboxItems: vi.fn(),
  updateOutboxItem: vi.fn(),
}))

// The mocked module exports ARE the mock fns; cast only for typing
// (bun test does not provide vi.mocked).
const mockedAddOutboxItem = addOutboxItem as unknown as Mock
const mockedDeleteOutboxItem = deleteOutboxItem as unknown as Mock
const mockedGetOutboxItemByClientMessageId = getOutboxItemByClientMessageId as unknown as Mock
const mockedListDueOutboxItems = listDueOutboxItems as unknown as Mock
const mockedUpdateOutboxItem = updateOutboxItem as unknown as Mock

function makeOutboxItem(overrides: Partial<LocalOutboxItem> = {}): LocalOutboxItem {
  return {
    id: 'outbox-1',
    conversation_id: 'conv-1',
    client_message_id: 'client-1',
    parent_message_id: null,
    role: 'assistant',
    content: 'Hello',
    visible_content: 'Hello',
    execution_trace: [],
    response_contract_version: 2,
    attached_data: {},
    attempt_count: 0,
    next_retry_at: '2026-02-13T10:00:00.000Z',
    status: 'pending',
    last_error: null,
    created_at: '2026-02-13T10:00:00.000Z',
    updated_at: '2026-02-13T10:00:00.000Z',
    ...overrides,
  }
}

describe('persistence outbox', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns persisted when persistence succeeds', async () => {
    mockedGetOutboxItemByClientMessageId.mockResolvedValue(undefined)

    const persistMessage = vi.fn().mockResolvedValue(undefined)
    const result = await persistMessageWithOutbox(persistMessage, {
      conversationId: 'conv-1',
      clientMessageId: 'client-1',
      role: 'user',
      content: 'Hi',
    })

    expect(result.status).toBe('persisted')
    expect(mockedAddOutboxItem).not.toHaveBeenCalled()
  })

  it('queues message when persistence fails', async () => {
    mockedGetOutboxItemByClientMessageId.mockResolvedValue(undefined)

    const persistMessage = vi.fn().mockRejectedValue(new Error('network down'))
    const result = await persistMessageWithOutbox(persistMessage, {
      conversationId: 'conv-1',
      clientMessageId: 'client-1',
      role: 'user',
      content: 'Hi',
    })

    expect(result.status).toBe('queued')
    expect(mockedAddOutboxItem).toHaveBeenCalledTimes(1)
  })

  it('retries due outbox items with backoff on transient failure', async () => {
    mockedListDueOutboxItems.mockResolvedValue([makeOutboxItem({ attempt_count: 1 })])

    const persistMessage = vi.fn().mockRejectedValue(new Error('temporary failure'))
    const result = await flushMessagePersistenceOutbox(persistMessage)

    expect(result.persisted).toBe(0)
    expect(result.terminalFailures).toHaveLength(0)
    expect(mockedUpdateOutboxItem).toHaveBeenCalledTimes(1)
    expect(mockedUpdateOutboxItem).toHaveBeenCalledWith(
      'outbox-1',
      expect.objectContaining({
        status: 'pending',
        attempt_count: 2,
        last_error: 'temporary failure',
      })
    )
  })

  it('marks item as failed after max retry attempts', async () => {
    mockedListDueOutboxItems.mockResolvedValue([
      makeOutboxItem({ attempt_count: MAX_OUTBOX_ATTEMPTS - 1 }),
    ])

    const persistMessage = vi.fn().mockRejectedValue(new Error('permanent failure'))
    const result = await flushMessagePersistenceOutbox(persistMessage)

    expect(result.terminalFailures).toHaveLength(1)
    expect(mockedUpdateOutboxItem).toHaveBeenCalledWith(
      'outbox-1',
      expect.objectContaining({
        status: 'failed',
        attempt_count: MAX_OUTBOX_ATTEMPTS,
        last_error: 'permanent failure',
      })
    )
  })

  it('deletes outbox item after successful flush persistence', async () => {
    mockedListDueOutboxItems.mockResolvedValue([makeOutboxItem()])

    const persistMessage = vi.fn().mockResolvedValue(undefined)
    const result = await flushMessagePersistenceOutbox(persistMessage)

    expect(result.persisted).toBe(1)
    expect(mockedDeleteOutboxItem).toHaveBeenCalledWith('outbox-1')
  })
})
