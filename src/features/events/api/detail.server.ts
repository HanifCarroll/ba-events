import { error } from '@sveltejs/kit'
import { Effect } from 'effect'
import { getEventWithVenueByIdEffect } from './crud.server.ts'
import { buildEventDetailData } from '#features/events/lib/event-detail-data.ts'
import type { EventWithVenue } from '#shared/lib/types.ts'

export function getEventDetailDataEffect(id: string): Effect.Effect<ReturnType<typeof buildEventDetailData>, never> {
	return Effect.match(getEventWithVenueByIdEffect(id), {
		onFailure: () => { throw error(404, 'Event not found') },
		onSuccess: (event) => buildEventDetailData(event as EventWithVenue),
	})
}

export function getEventDetailData(id: string) {
	return Effect.runPromise(getEventDetailDataEffect(id))
}
