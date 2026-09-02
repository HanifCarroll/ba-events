import type { PageServerLoad } from './$types'
import { Effect } from 'effect'
import { getConversationEffect } from '#features/chat/api/conversations.server.ts'
import { getEventDetailDataEffect } from '#features/events/api/detail.server.ts'
import { getConversationTurnsEffect } from '#features/chat/api/turns.server.ts'

export const load: PageServerLoad = async (event) => {
	const { conversationId } = event.params
	const eventId = event.untrack(() => event.url.searchParams.get('event'))

	const conversationPromise = event.locals.user
		? Effect.runPromise(getConversationEffect(event, { id: conversationId }))
		: Promise.resolve(null)
	const turnsPromise = event.locals.user
		? Effect.runPromise(getConversationTurnsEffect(event, conversationId))
		: Promise.resolve([])
	const selectedEventPromise = eventId ? Effect.runPromise(getEventDetailDataEffect(eventId)) : Promise.resolve(undefined)
	const [conversation, turns, selectedEvent] = await Promise.all([
		conversationPromise,
		turnsPromise,
		selectedEventPromise
	])

  return { conversation, turns, selectedEvent }
}
