import { describe, expect, it } from 'vitest'
import { parseMainChatRequest } from './main-request.ts'

describe('main chat request decoder', () => {
	it('keeps legacy defaults for malformed optional fields', () => {
		expect(parseMainChatRequest({ messages: {}, locale: 'fr', happeningSoonEventIds: 'nope', retry: 'yes' })).toEqual({})
	})

	it('keeps owned control values and strips unknown fields', () => {
		expect(parseMainChatRequest({
		locale: 'es',
		conversationId: null,
		turnId: 'turn',
		happeningSoonEventIds: ['a', 2],
		forged: 'ignored',
		})).toEqual({
		locale: 'es',
		conversationId: null,
		turnId: 'turn',
		happeningSoonEventIds: ['a', 2],
		})
	})
})
