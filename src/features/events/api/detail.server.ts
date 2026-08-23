import { error } from '@sveltejs/kit'
import { getEventWithVenueById } from './crud.server.ts'
import { buildEventJsonLd, buildEventSummary } from '#features/events/lib/event-summary.ts'
import { getEventUrl, resolveSiteUrl } from '#shared/lib/utils/url.ts'
import type { EventWithVenue } from '#shared/lib/types.ts'

export async function getEventDetailData(id: string) {
	let event: EventWithVenue
	try {
		event = await getEventWithVenueById(id)
	} catch {
		throw error(404, 'Event not found')
	}

	const eventUrl = getEventUrl(event.id)
	const summary = buildEventSummary(event)
	const imageUrl = event.image_url
		? resolveSiteUrl(event.image_url)
		: resolveSiteUrl('/og-image-2026.jpg')

	return {
		event,
		meta: {
			title: `${event.name} - BA Eventos`,
			description: summary,
			imageUrl,
			eventUrl,
			jsonLd: buildEventJsonLd(event, eventUrl, imageUrl)
		}
	}
}
