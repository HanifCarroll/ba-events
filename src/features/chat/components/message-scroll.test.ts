import { describe, expect, it } from 'vitest'
import {
	ASSISTANT_RESPONSE_TOP_PADDING,
	scrollAssistantToTop,
	updateAssistantTopScroll,
	type AssistantTopScrollState
} from './message-scroll.ts'

// Logic-level port of the legacy `MessageList.scroll.test.tsx`. The DOM stubs
// are gone; the completion top-alignment state machine and the scroll-geometry
// math are exercised directly.

const initialState = (): AssistantTopScrollState => ({
	pendingScrollAssistantId: null,
	prevLastAssistantId: null
})

describe('MessageList completion top-alignment state machine', () => {
	it('does not scroll while the response is still streaming', () => {
		const { state, scrollToAssistantId } = updateAssistantTopScroll(
			initialState(),
			true,
			'a1'
		)

		expect(scrollToAssistantId).toBeNull()
		expect(state.pendingScrollAssistantId).toBe('a1')
		expect(state.prevLastAssistantId).toBe('a1')
	})

	it('reports the finished assistant response once loading ends', () => {
		const first = updateAssistantTopScroll(initialState(), true, 'a1')

		const { state, scrollToAssistantId } = updateAssistantTopScroll(
			first.state,
			false,
			'a1'
		)

		expect(scrollToAssistantId).toBe('a1')
		expect(state.pendingScrollAssistantId).toBeNull()
		expect(state.prevLastAssistantId).toBe('a1')
	})

	it('does not scroll when a conversation is loaded with no request in flight', () => {
		const { state, scrollToAssistantId } = updateAssistantTopScroll(
			initialState(),
			false,
			'a1'
		)

		expect(scrollToAssistantId).toBeNull()
		expect(state.pendingScrollAssistantId).toBeNull()
		expect(state.prevLastAssistantId).toBe('a1')
	})

	it('does not scroll when a request ends without an assistant message', () => {
		const first = updateAssistantTopScroll(initialState(), true, null)

		const { state, scrollToAssistantId } = updateAssistantTopScroll(first.state, false, null)

		expect(scrollToAssistantId).toBeNull()
		expect(state.pendingScrollAssistantId).toBeNull()
		expect(state.prevLastAssistantId).toBeNull()
	})
})

describe('scrollAssistantToTop geometry', () => {
	it('aligns the assistant response with padding on a touch device', () => {
		const calls: ScrollToOptions[] = []
		const container = {
			getBoundingClientRect: () => ({ top: 80 }),
			scrollTop: 0,
			scrollTo: (options: ScrollToOptions) => {
				calls.push(options)
			}
		}
		const messageElement = {
			getBoundingClientRect: () => ({ top: 320 })
		}

		// jsdom-free: `window`/`navigator` may not exist; the helper guards them.
		scrollAssistantToTop(container, messageElement)

		// 320 (message top) - 80 (container top) + 0 (scrollTop) - 24 (padding)
		expect(calls[0]?.top).toBe(320 - 80 + 0 - ASSISTANT_RESPONSE_TOP_PADDING)
	})
})
