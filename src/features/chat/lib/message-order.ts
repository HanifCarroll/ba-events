import type { MessageRole } from '@/shared/lib/types'

type OrderedMessageLike = {
  turn_index?: number | null
  sequence_number?: number | null
  role: MessageRole
  id: string
}

const ROLE_ORDER_ASC: Record<MessageRole, number> = {
  user: 0,
  assistant: 1,
  system: 2,
}

function toTurnIndex(message: OrderedMessageLike): number {
  if (typeof message.turn_index === 'number') return message.turn_index
  if (typeof message.sequence_number === 'number') return message.sequence_number
  return 0
}

/**
 * Deterministic message order for rendering and persistence reads.
 * Primary: turn index
 * Secondary: role order (user -> assistant -> system)
 * Tertiary: stable ID compare
 */
export function compareMessagesByTurnOrderAsc(
  a: OrderedMessageLike,
  b: OrderedMessageLike
): number {
  const turnDiff = toTurnIndex(a) - toTurnIndex(b)
  if (turnDiff !== 0) return turnDiff

  const roleDiff = ROLE_ORDER_ASC[a.role] - ROLE_ORDER_ASC[b.role]
  if (roleDiff !== 0) return roleDiff

  return a.id.localeCompare(b.id)
}

export function sortMessagesByTurnOrderAsc<T extends OrderedMessageLike>(messages: T[]): T[] {
  return [...messages].sort(compareMessagesByTurnOrderAsc)
}

export function pickLatestMessageByTurnOrder<T extends OrderedMessageLike>(
  messages: T[]
): T | null {
  if (messages.length === 0) return null

  return messages.reduce((latest, current) => {
    return compareMessagesByTurnOrderAsc(current, latest) > 0 ? current : latest
  })
}
