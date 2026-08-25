import { describe, expect, it } from 'vitest'
import {
  applyAuthoritativeTurn,
  mayRunProvider,
  parseChatTurnBootstrapInput,
} from './turn-authority.ts'

const turn = {
  id: 'turn', conversation_id: 'owned-conversation', user_message_id: 'user-message',
  assistant_message_id: null, user_client_message_id: 'owned-user',
  assistant_client_message_id: 'owned-assistant', content: 'authoritative text', locale: 'es',
  status: 'running', claim_id: 'claim', claimed_until: null, attempt_count: 1, last_error: null
} as const

describe('authenticated chat turn authority', () => {
  it('accepts only complete UUID-keyed bootstrap payloads', () => {
    const input = {
      conversationId: '11111111-1111-4111-8111-111111111111',
      turnId: '22222222-2222-4222-8222-222222222222',
      userClientMessageId: '33333333-3333-4333-8333-333333333333',
      assistantClientMessageId: '44444444-4444-4444-8444-444444444444',
      content: 'events tonight',
      locale: 'en',
    }
    expect(parseChatTurnBootstrapInput(input)).toEqual(input)
    expect(parseChatTurnBootstrapInput({ ...input, turnId: 'not-a-uuid' })).toBeNull()
    expect(parseChatTurnBootstrapInput({ ...input, content: null })).toBeNull()
    expect(parseChatTurnBootstrapInput({ ...input, locale: 'fr' })).toBeNull()
  })

  it('overwrites every client identity and prompt field', () => {
    expect(applyAuthoritativeTurn({
      conversationId: 'forged-conversation', userClientMessageId: 'forged-user',
      assistantClientMessageId: 'forged-assistant', originalQuery: 'forged text', locale: 'en'
    }, turn)).toMatchObject({
      conversationId: 'owned-conversation', userClientMessageId: 'owned-user',
      assistantClientMessageId: 'owned-assistant', originalQuery: 'authoritative text', locale: 'es'
    })
  })

  it('suppresses provider execution for duplicate claims and completed turns', () => {
    expect(mayRunProvider(turn, 'claim')).toBe(true)
    expect(mayRunProvider(turn, 'other-claim')).toBe(false)
    expect(mayRunProvider({ ...turn, status: 'completed' }, 'claim')).toBe(false)
  })
})
