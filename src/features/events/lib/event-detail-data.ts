import { buildEventJsonLd, buildEventSummary } from './event-summary.ts'
import type { EventWithVenue } from '#shared/lib/types.ts'
import { getEventUrl, resolveSiteUrl } from '#shared/lib/utils/url.ts'

export function buildEventDetailData(event: EventWithVenue) {
	const eventUrl = getEventUrl(event.id)
	const imageUrl = event.image_url
		? resolveSiteUrl(event.image_url)
		: resolveSiteUrl('/og-image-2026.jpg')

	return {
		event,
		meta: {
			title: `${event.name} - BA Eventos`,
			description: buildEventSummary(event),
			imageUrl,
			eventUrl,
			jsonLd: buildEventJsonLd(event, eventUrl, imageUrl)
		}
	}
}
