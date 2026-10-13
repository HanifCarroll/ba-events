import { describe, expect, it } from 'vitest'
import { adaptStoredMessageToCanonical } from './canonical.ts'
import { createResponseFeedback, responseFeedbackContext, type ResponseFeedbackContext } from './response-feedback.ts'

const context: ResponseFeedbackContext = { responseId: 'opaque-response-1', responseKind: 'recommendations', eventsReturned: 2 }
function harness() {
	const data = new Map<string, string>()
	const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
	const events: Array<{ event: string; properties: Record<string, unknown> }> = []
	const emit = (event: string, properties: Record<string, unknown>) => { events.push({ event, properties }) }
	return { data, storage, events, emit }
}

describe('response helpfulness', () => {
	it('rates only settled canonical responses and carries no reply text', () => {
		const canonical = adaptStoredMessageToCanonical({ id: 'reply-1', content: 'Private reply text' })
		expect(responseFeedbackContext(null, false)).toBeUndefined()
		expect(responseFeedbackContext(canonical, true)).toBeUndefined()
		expect(responseFeedbackContext(canonical, false)).toEqual({ responseId: canonical.requestId, responseKind: canonical.kind, eventsReturned: 0 })
	})
	it('counts visible offers independently of whether someone votes', () => {
		const h = harness()
		const feedback = createResponseFeedback(context, h.storage, h.emit)
		feedback.show(); feedback.show()
		expect(feedback.state.rating).toBeNull()
		expect(h.events).toEqual([{ event: 'chat:feedback_shown', properties: { response_id: context.responseId, response_kind: 'recommendations', events_returned: 2 } }])
	})
	it('retains the selection across remounts and reports corrections rather than duplicate votes', () => {
		const h = harness()
		const first = createResponseFeedback(context, h.storage, h.emit)
		first.rate('helpful'); first.rate('helpful')
		const second = createResponseFeedback(context, h.storage, h.emit)
		expect(second.state).toEqual({ shown: true, rating: 'helpful' })
		second.show(); second.rate('helpful'); second.rate('not_helpful')
		expect(h.events.map(entry => entry.event)).toEqual(['chat:feedback_shown', 'chat:helpfulness_rated', 'chat:helpfulness_rated'])
		expect(h.events[2].properties).toEqual({ response_id: context.responseId, response_kind: 'recommendations', events_returned: 2, rating: 'not_helpful', previous_rating: 'helpful' })
		expect(createResponseFeedback(context, h.storage, h.emit).state.rating).toBe('not_helpful')
	})
	it('keeps different responses independent and records a rating even before visibility callback', () => {
		const h = harness()
		createResponseFeedback(context, h.storage, h.emit).rate('not_helpful')
		const next = createResponseFeedback({ ...context, responseId: 'opaque-response-2' }, h.storage, h.emit)
		expect(next.state).toEqual({ shown: false, rating: null })
		expect(h.events.map(entry => entry.event)).toEqual(['chat:feedback_shown', 'chat:helpfulness_rated'])
	})
	it('works when storage or analytics is unavailable without affecting chat', () => {
		const storage = { getItem: () => { throw new Error('Denied') }, setItem: () => { throw new Error('Full') } }
		const feedback = createResponseFeedback(context, storage, () => { throw new Error('Unavailable') })
		feedback.rate('not_helpful')
		expect(feedback.state).toEqual({ shown: true, rating: 'not_helpful' })
	})
	it('ignores malformed session state and bounds browser retention', () => {
		const h = harness()
		h.storage.setItem('ba-eventos:response-feedback:v1', '{broken')
		expect(createResponseFeedback(context, h.storage, h.emit).state.rating).toBeNull()
		for (let i = 0; i < 205; i++) createResponseFeedback({ ...context, responseId: `response-${i}` }, h.storage, h.emit).show()
		const saved = JSON.parse(h.storage.getItem('ba-eventos:response-feedback:v1')!)
		expect(saved).toHaveLength(200)
		expect(saved[0].responseId).toBe('response-5')
		expect(saved[199].responseId).toBe('response-204')
	})
})
