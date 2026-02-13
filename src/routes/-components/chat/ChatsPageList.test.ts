import { describe, expect, it } from 'vitest'
import { isLikelyNamingPending } from './ChatsPageList'
import type { ConversationListItem } from '@/shared/lib/types'

function makeConversation(overrides: Partial<ConversationListItem> = {}): ConversationListItem {
  return {
    id: 'conv_1',
    title: 'New conversation',
    updated_at: new Date().toISOString(),
    preview: 'Find jazz events in Palermo tonight',
    ...overrides,
  }
}

describe('ChatsPageList naming status', () => {
  it('marks recent generic titled conversations with preview as naming', () => {
    const nowMs = new Date('2026-02-13T12:00:00.000Z').getTime()
    const conversation = makeConversation({
      updated_at: new Date(nowMs - 30_000).toISOString(),
    })

    expect(isLikelyNamingPending(conversation, nowMs)).toBe(true)
  })

  it('does not mark older generic titled conversations as naming', () => {
    const nowMs = new Date('2026-02-13T12:00:00.000Z').getTime()
    const conversation = makeConversation({
      updated_at: new Date(nowMs - 3 * 60_000).toISOString(),
    })

    expect(isLikelyNamingPending(conversation, nowMs)).toBe(false)
  })

  it('does not mark non-generic titled conversations as naming', () => {
    const nowMs = new Date('2026-02-13T12:00:00.000Z').getTime()
    const conversation = makeConversation({
      title: 'Jazz Night in Palermo',
      updated_at: new Date(nowMs - 30_000).toISOString(),
    })

    expect(isLikelyNamingPending(conversation, nowMs)).toBe(false)
  })
})

