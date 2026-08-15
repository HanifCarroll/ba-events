import {
  addOutboxItem,
  deleteOutboxItem,
  getOutboxItemByClientMessageId,
  listDueOutboxItems,
  updateOutboxItem,
} from '#shared/lib/db/local-outbox.ts'
import type { LocalOutboxItem } from '#shared/lib/db/local-outbox.ts'
import type { MessageAttachedData, MessageExecutionStep, MessageRole } from '#shared/lib/types.ts'

const BASE_RETRY_DELAY_MS = 2_000
const MAX_RETRY_DELAY_MS = 120_000
export const MAX_OUTBOX_ATTEMPTS = 6

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
    response_contract_version: payload.responseContractVersion ?? 2,
    attached_data: payload.attachedData ?? {},
    attempt_count: 0,
    next_retry_at: new Date().toISOString(),
  })
}

export async function persistMessageWithOutbox(
  persistMessage: PersistMessageFn,
  payload: MessagePersistencePayload
): Promise<MessagePersistenceResult> {
  try {
    const persisted = await persistMessage(payload)
    const messageId =
      persisted && typeof persisted === 'object' && typeof persisted.id === 'string'
        ? persisted.id
        : undefined

    const existing = await getOutboxItemByClientMessageId(
      payload.conversationId,
      payload.clientMessageId
    )
    if (existing) {
      await deleteOutboxItem(existing.id)
    }

    return { status: 'persisted', messageId }
  } catch {
    await ensureOutboxItem(payload)
    return { status: 'queued' }
  }
}

export async function flushMessagePersistenceOutbox(
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

    try {
      await persistMessage(payload)
      await deleteOutboxItem(item.id)
      persisted++
      continue
    } catch (error) {
      const attemptCount = item.attempt_count + 1
      const errorMessage = toErrorMessage(error)

      if (attemptCount >= MAX_OUTBOX_ATTEMPTS) {
        await updateOutboxItem(item.id, {
          status: 'failed',
          attempt_count: attemptCount,
          last_error: errorMessage,
          next_retry_at: item.next_retry_at,
        })

        terminalFailures.push({
          ...item,
          status: 'failed',
          attempt_count: attemptCount,
          last_error: errorMessage,
        })
        continue
      }

      await updateOutboxItem(item.id, {
        status: 'pending',
        attempt_count: attemptCount,
        last_error: errorMessage,
        next_retry_at: getNextRetryIso(attemptCount),
      })
    }
  }

  return {
    processed: due.length,
    persisted,
    terminalFailures,
  }
}
