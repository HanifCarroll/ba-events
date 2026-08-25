import { describe, expect, it } from 'vitest'
import { getChatConversationId } from './chat-navigation.ts'

describe('chat route identity', () => {
	it('uses route params or the URL only', () => {
		expect(getChatConversationId('/chat/from-url', 'from-param')).toBe('from-param')
		expect(getChatConversationId('/', undefined)).toBeNull()
		expect(getChatConversationId('/chat/from-url')).toBe('from-url')
		expect(getChatConversationId('/chat')).toBeNull()
		expect(getChatConversationId('/')).toBeNull()
	})
})
