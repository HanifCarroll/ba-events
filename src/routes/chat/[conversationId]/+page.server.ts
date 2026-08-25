import type { PageServerLoad } from './$types'
import { getConversation } from '#features/chat/api/conversations.server.ts'
import { getEventDetailData } from '#features/events/api/detail.server.ts'
import { getConversationTurns } from '#features/chat/api/turns.server.ts'

export const load: PageServerLoad = async (event) => {
	const { conversationId } = event.params
	const eventId = event.untrack(() => event.url.searchParams.get('event'))

	const conversationPromise = event.locals.user
		? getConversation(event, { id: conversationId })
		: Promise.resolve(null)
	const turnsPromise = event.locals.user
		? getConversationTurns(event, conversationId)
		: Promise.resolve([])
	const selectedEventPromise = eventId ? getEventDetailData(eventId) : Promise.resolve(undefined)
	const [conversation, turns, selectedEvent] = await Promise.all([
		conversationPromise,
		turnsPromise,
		selectedEventPromise
	])

  return { conversation, turns, selectedEvent }
}
