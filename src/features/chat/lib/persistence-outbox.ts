import {
  addOutboxItem,
  deleteOutboxItem,
  getOutboxItemByClientMessageId,
  listDueOutboxItems,
  updateOutboxItem,
} from '#shared/lib/db/local-outbox.ts'
import type { LocalOutboxItem } from '#shared/lib/db/local-outbox.ts'
import { CHAT_CONTRACT_VERSION } from '#shared/lib/types.ts'
import type { MessageAttachedData, MessageExecutionStep, MessageRole } from '#shared/lib/types.ts'

import { createActor, toPromise } from 'xstate'
import { outboxAttemptMachine } from './persistence-outbox.machine.ts'
export { MAX_OUTBOX_ATTEMPTS } from './persistence-outbox.machine.ts'

const BASE_RETRY_DELAY_MS = 2_000
const MAX_RETRY_DELAY_MS = 120_000

export interface MessagePersistencePayload {
  conversationId: string
  parentMessageId?: string | null
  clientMessageId: string
  role: MessageRole
  content: string
  visibleContent?: string
  executionTrace?: MessageExecutionStep[]
  responseContractVersion?: number
  attachedData?: MessageAttachedData
}

export interface MessagePersistenceResult {
  status: 'persisted' | 'queued'
  messageId?: string
}

export type PersistMessageFn = (
  payload: MessagePersistencePayload
) => Promise<{ id?: string } | void>

export interface FlushOutboxResult {
  processed: number
  persisted: number
  terminalFailures: LocalOutboxItem[]
}

export function getConversationTerminalFailures(
  failures: LocalOutboxItem[],
  conversationId: string | null
): LocalOutboxItem[] {
  return conversationId
    ? failures.filter((failure) => failure.conversation_id === conversationId)
    : []
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return 'Unknown persistence error'
}

function calculateRetryDelayMs(attemptCount: number): number {
  const exponent = Math.max(0, attemptCount - 1)
  return Math.min(BASE_RETRY_DELAY_MS * 2 ** exponent, MAX_RETRY_DELAY_MS)
}

function getNextRetryIso(attemptCount: number): string {
  return new Date(Date.now() + calculateRetryDelayMs(attemptCount)).toISOString()
}

async function ensureOutboxItem(payload: MessagePersistencePayload): Promise<void> {
  const existing = await getOutboxItemByClientMessageId(
    payload.conversationId,
    payload.clientMessageId
  )

  if (existing) return

  await addOutboxItem({
    conversation_id: payload.conversationId,
    client_message_id: payload.clientMessageId,
    parent_message_id: payload.parentMessageId ?? null,
    role: payload.role,
    content: payload.content,
    visible_content: payload.visibleContent ?? payload.content,
    execution_trace: payload.executionTrace ?? [],
    response_contract_version: payload.responseContractVersion ?? CHAT_CONTRACT_VERSION,
    attached_data: payload.attachedData ?? {},
    attempt_count: 0,
    next_retry_at: new Date().toISOString(),
  })
}

export async function persistMessageWithOutbox(
  persistMessage: PersistMessageFn,
  payload: MessagePersistencePayload
): Promise<MessagePersistenceResult> {
  let existing: LocalOutboxItem | undefined
  let messageId: string | undefined
  const actor = createActor(outboxAttemptMachine, { input: {
    attemptCount: 0, alreadyPersisted: false,
    persist: async () => {
      const result = await persistMessage(payload)
      messageId = result && typeof result.id === 'string' ? result.id : undefined
    },
    acknowledge: async () => {
      existing = await getOutboxItemByClientMessageId(payload.conversationId, payload.clientMessageId)
      if (existing) await updateOutboxItem(existing.id, { status: 'persisted', last_error: null })
    },
    cleanup: async () => { if (existing) await deleteOutboxItem(existing.id) },
  } }).start()
  const result = await toPromise(actor)
  if (result.outcome === 'retry_wait' || result.outcome === 'failed') {
    await ensureOutboxItem(payload)
    return { status: 'queued' }
  }
  return { status: 'persisted', messageId }
}

let flushInFlight: Promise<FlushOutboxResult> | null = null

/** One flush per browser, and per origin when Web Locks is available. */
export function flushMessagePersistenceOutbox(persistMessage: PersistMessageFn): Promise<FlushOutboxResult> {
  if (flushInFlight) return flushInFlight
  const run = () => flushOutbox(persistMessage)
  flushInFlight = (typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request('ba-events:legacy-message-outbox', run)
    : run()).finally(() => { flushInFlight = null })
  return flushInFlight
}

async function flushOutbox(
  persistMessage: PersistMessageFn
): Promise<FlushOutboxResult> {
  const due = await listDueOutboxItems()
  const terminalFailures: LocalOutboxItem[] = []

  let persisted = 0

  for (const item of due) {
    const payload: MessagePersistencePayload = {
      conversationId: item.conversation_id,
      parentMessageId: item.parent_message_id,
      clientMessageId: item.client_message_id,
      role: item.role,
      content: item.content,
      visibleContent: item.visible_content,
      executionTrace: item.execution_trace,
      responseContractVersion: item.response_contract_version,
      attachedData: item.attached_data,
    }

    const actor = createActor(outboxAttemptMachine, { input: {
      attemptCount: item.attempt_count, alreadyPersisted: item.status === 'persisted',
      persist: () => persistMessage(payload),
      acknowledge: () => updateOutboxItem(item.id, { status: 'persisted', last_error: null }),
      cleanup: () => deleteOutboxItem(item.id),
    } }).start()
    const result = await toPromise(actor)
    if (result.outcome !== 'retry_wait' && result.outcome !== 'failed') {
      // Receipt failure remains uncertain locally; stable client IDs make a later
      // retry idempotent. A recorded receipt skips the remote write on reload.
      persisted++
      continue
    }
    const errorMessage = toErrorMessage(result.error)
    const failed = result.outcome === 'failed'
    await updateOutboxItem(item.id, {
      status: failed ? 'failed' : 'pending',
      attempt_count: result.attemptCount,
      last_error: errorMessage,
      next_retry_at: failed ? item.next_retry_at : getNextRetryIso(result.attemptCount),
    })
    if (failed) terminalFailures.push({ ...item, status: 'failed', attempt_count: result.attemptCount, last_error: errorMessage })

  }

  return {
    processed: due.length,
    persisted,
    terminalFailures,
  }
}
