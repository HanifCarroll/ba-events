import type { PageServerLoad } from './$types'
import { getConversation } from '#features/chat/api/conversations.server.ts'
import { getEventDetailData } from '#features/events/api/detail.server.ts'

export const load: PageServerLoad = async (event) => {
	const { conversationId } = event.params
	const eventId = event.untrack(() => event.url.searchParams.get('event'))

	const conversationPromise = event.locals.user
		? getConversation(event, { id: conversationId })
		: Promise.resolve(null)
	const selectedEventPromise = eventId ? getEventDetailData(eventId) : Promise.resolve(undefined)
	const [conversation, selectedEvent] = await Promise.all([
		conversationPromise,
		selectedEventPromise
	])

	return { conversation, selectedEvent }
}
