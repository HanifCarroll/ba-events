import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getEventWithVenueById } from '#features/events/api/crud.server.ts';
import { getEventUrl, resolveSiteUrl } from '#shared/lib/utils/url.ts';
import { buildEventSummary, buildEventJsonLd } from '#features/events/lib/event-summary.ts';
import type { EventWithVenue } from '#shared/lib/types.ts';

export const load: PageServerLoad = async ({ params }) => {
	let event: EventWithVenue;
	try {
		event = await getEventWithVenueById(params.id);
	} catch {
		throw error(404, 'Event not found');
	}

	const eventUrl = getEventUrl(event.id);
	const summary = buildEventSummary(event);
	const imageUrl = event.image_url
		? resolveSiteUrl(event.image_url)
		: resolveSiteUrl('/og-image-2026.jpg');
	const eventJsonLd = buildEventJsonLd(event, eventUrl, imageUrl);

	return {
		event,
		meta: {
			title: `${event.name} - BA Eventos`,
			description: summary,
			imageUrl,
			eventUrl,
			jsonLd: eventJsonLd
		}
	};
};
