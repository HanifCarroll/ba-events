import { describe, expect, it } from 'vitest'
import { parseConsentCallback, parseTelegramText, parseTelegramUpdate } from './update.ts'

const privateMessage = {
  update_id: 9_007_199_254_740_991,
  message: {
    message_id: 42,
    from: { id: 123456789, is_bot: false, language_code: 'es' },
    chat: { id: 123456789, type: 'private' },
    date: 1_700_000_000,
    text: '  tango tonight  ',
  },
}

describe('Telegram update boundary', () => {
  it('accepts the pilot subset and converts integer IDs to strings', () => {
    const parsed = parseTelegramUpdate(privateMessage)

    expect(parsed).not.toBeNull()
    expect(parsed?.update_id).toBe('9007199254740991')
    expect(parsed && 'message' in parsed ? parsed.message.from.id : null).toBe('123456789')
    expect(parsed && 'message' in parsed ? parsed.message.chat.id : null).toBe('123456789')
  })

  it.each([
    ['group chat', { ...privateMessage, message: { ...privateMessage.message, chat: { id: -1, type: 'group' } } }],
    ['bot sender', { ...privateMessage, message: { ...privateMessage.message, from: { id: 1, is_bot: true } } }],
    ['media only', { update_id: 1, message: { ...privateMessage.message, text: undefined } }],
    ['edited update', { update_id: 1, edited_message: privateMessage.message }],
    ['oversized text', { ...privateMessage, message: { ...privateMessage.message, text: 'x'.repeat(4097) } }],
    ['unsafe id', { ...privateMessage, message: { ...privateMessage.message, chat: { id: Number.MAX_SAFE_INTEGER + 1, type: 'private' } } }],
  ])('ignores %s', (_name, update) => {
    expect(parseTelegramUpdate(update)).toBeNull()
  })

  it('accepts only the versioned private-chat consent callback', () => {
    const callback = {
      update_id: 1,
      callback_query: {
        id: 'callback-1',
        from: { id: 123, is_bot: false },
        message: { message_id: 2, chat: { id: 123, type: 'private' } },
        data: 'consent:v1:accept',
      },
    }

    expect(parseTelegramUpdate(callback)).not.toBeNull()
    expect(parseConsentCallback('consent:v1:accept')).toBe('accept')
    expect(parseConsentCallback('consent:v2:accept')).toBeNull()
    expect(parseTelegramUpdate({ ...callback, callback_query: { ...callback.callback_query, data: 'unknown' } })).toBeNull()
  })
})

describe('Telegram commands', () => {
  it.each(['start', 'help', 'new', 'privacy', 'delete'] as const)('parses /%s deterministically', (command) => {
    expect(parseTelegramText(`/${command}`)).toEqual({ kind: 'command', command })
  })

  it('supports Telegram bot suffixes and ignores unknown slash forms', () => {
    expect(parseTelegramText('/help@ba_events_bot')).toEqual({ kind: 'command', command: 'help' })
    expect(parseTelegramText('/help now')).toBeNull()
    expect(parseTelegramText('/unknown')).toBeNull()
    expect(parseTelegramText('  jazz tomorrow  ')).toEqual({ kind: 'text', text: 'jazz tomorrow' })
  })
})
