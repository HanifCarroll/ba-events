import type { UIMessage } from 'ai'
import type { Message } from '#shared/lib/types.ts'
import { extractVisibleTextFromUIMessageParts } from '#features/chat/lib/extract-visible-text.ts'

export const MAX_AGENT_HISTORY_MESSAGES = 12
export const MAX_AGENT_HISTORY_TEXT = 2000
export const MAX_AGENT_HISTORY_TOTAL_TEXT = 6000

export interface AgentHistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

function bounded(role: AgentHistoryMessage['role'], content: string): AgentHistoryMessage | null {
  const text = content.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_AGENT_HISTORY_TEXT)
  return text ? { role, content: text } : null
}

function withoutCurrent(messages: AgentHistoryMessage[], currentText: string): AgentHistoryMessage[] {
  const current = currentText.trim()
  if (!current) return messages
  const last = messages.at(-1)
  return last?.role === 'user' && last.content === current ? messages.slice(0, -1) : messages
}

/** Keep a contiguous suffix of whole messages; server-owned facts live separately. */
export function boundAgentHistory(messages: AgentHistoryMessage[]): AgentHistoryMessage[] {
  const normalized = messages.map(message => bounded(message.role, message.content))
    .filter((message): message is AgentHistoryMessage => message !== null)
    .slice(-MAX_AGENT_HISTORY_MESSAGES)
  const retained: AgentHistoryMessage[] = []
  let total = 0
  for (let index = normalized.length - 1; index >= 0; index--) {
    const message = normalized[index]
    if (total + message.content.length > MAX_AGENT_HISTORY_TOTAL_TEXT) break
    retained.push(message)
    total += message.content.length
  }
  return retained.reverse()
}

export function buildAgentHistoryFromUIMessages(messages: UIMessage[], currentText: string): AgentHistoryMessage[] {
  const history = messages
    .map((message) => {
      const content = extractVisibleTextFromUIMessageParts(message.parts as Array<{ type?: string; text?: string }>)
      return bounded(message.role === 'assistant' ? 'assistant' : 'user', content)
    })
    .filter((message): message is AgentHistoryMessage => message !== null)
  return boundAgentHistory(withoutCurrent(history, currentText))
}

export function buildAgentHistoryFromStoredMessages(messages: Message[], currentText: string): AgentHistoryMessage[] {
  const history = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => bounded(message.role === 'assistant' ? 'assistant' : 'user', message.visible_content || message.content))
    .filter((message): message is AgentHistoryMessage => message !== null)
  return boundAgentHistory(withoutCurrent(history, currentText))
}
