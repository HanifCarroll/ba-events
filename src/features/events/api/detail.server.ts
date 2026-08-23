import { error } from '@sveltejs/kit'
import { getEventWithVenueById } from './crud.server.ts'
import { buildEventDetailData } from '#features/events/lib/event-detail-data.ts'
import type { EventWithVenue } from '#shared/lib/types.ts'

export async function getEventDetailData(id: string) {
	let event: EventWithVenue
	try {
		event = await getEventWithVenueById(id)
	} catch {
		throw error(404, 'Event not found')
	}

	return buildEventDetailData(event)
}
