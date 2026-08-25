import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import type { Message } from '#shared/lib/types.ts'
import { buildAgentHistoryFromStoredMessages, buildAgentHistoryFromUIMessages } from './history.ts'

const ui = (role: 'user' | 'assistant', text: string) => ({ role, parts: [{ type: 'text', text }] }) as UIMessage
const stored = (role: 'user' | 'assistant', text: string) => ({ role, visible_content: text, content: text }) as Message

describe('bounded agent history', () => {
  it('web history excludes the current user and keeps visible user/assistant text', () => {
    expect(buildAgentHistoryFromUIMessages([ui('user', 'old'), ui('assistant', 'answer'), ui('user', 'current')], 'current')).toEqual([
      { role: 'user', content: 'old' },
      { role: 'assistant', content: 'answer' },
    ])
  })

  it('stored authenticated and Telegram history use the same visible shape', () => {
    const expected = [{ role: 'user', content: 'old' }, { role: 'assistant', content: 'answer' }]
    expect(buildAgentHistoryFromStoredMessages([stored('user', 'old'), stored('assistant', 'answer'), stored('user', 'current')], 'current')).toEqual(expected)
    expect(buildAgentHistoryFromUIMessages([ui('user', 'old'), ui('assistant', 'answer'), ui('user', 'current')], 'current')).toEqual(expected)
  })

  it('does not remove an earlier repeated query when the loaded history ends with an assistant', () => {
    expect(buildAgentHistoryFromStoredMessages([
      stored('user', 'current'),
      stored('assistant', 'answer to the earlier query'),
    ], 'current')).toEqual([
      { role: 'user', content: 'current' },
      { role: 'assistant', content: 'answer to the earlier query' },
    ])
  })

  it('bounds count and each message', () => {
    const messages = Array.from({ length: 20 }, (_, index) => ui('user', `${index}-${'x'.repeat(3000)}`))
    const result = buildAgentHistoryFromUIMessages(messages, '')
    expect(result).toHaveLength(12)
    expect(result.every((message) => message.content.length <= 2000)).toBe(true)
  })
})
