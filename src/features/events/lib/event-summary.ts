import { BA_TIMEZONE } from '#shared/lib/constants.ts';
import { pickDescriptionSummary } from '#features/events/lib/description-presentation.ts';
import type { EventWithVenue } from '#shared/lib/types.ts';

/**
 * Human-readable label for a category slug ("live-music" → "Live Music").
 * Shared by the event detail page's category badges.
 */
export function formatCategoryLabel(category: string): string {
	return category
		.replace(/[-_]+/g, ' ')
		.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Locale-aware summary + fallback for meta descriptions and native-share text.
 * Defaults to English to match the legacy `head` (which used no locale).
 */
export function buildEventSummary(
	event: EventWithVenue,
	locale: 'en' | 'es' = 'en'
): string {
	const summary = pickDescriptionSummary(event, locale);
	const fallback = event.venue_neighborhood
		? `Event in ${event.venue_neighborhood}`
		: 'Event in Buenos Aires';
	const base = summary && summary.length > 0 ? summary : fallback;
	const maxLength = 160;

	if (base.length <= maxLength) return base;
	return `${base.slice(0, maxLength - 3).trim()}...`;
}

/**
 * JSON-LD structured data for the event detail page (SEO).
 */
export function buildEventJsonLd(
	event: EventWithVenue,
	eventUrl: string,
	imageUrl: string
) {
	const description = buildEventSummary(event);
	const isFree = event.is_free || event.price === 0;
	const venueName = event.venue_name || 'Venue';

	const location = event.location_hidden
		? {
				'@type': 'Place',
				name: venueName,
				address: {
					'@type': 'PostalAddress',
					addressLocality: 'Buenos Aires',
					addressCountry: 'AR'
				}
			}
		: {
				'@type': 'Place',
				name: venueName,
				address: {
					'@type': 'PostalAddress',
					addressLocality: 'Buenos Aires',
					addressCountry: 'AR',
					streetAddress: event.venue_address || undefined
				}
			};

	const offers = {
		'@type': 'Offer',
		price: isFree ? '0' : String(event.price ?? ''),
		priceCurrency: 'ARS',
		url: event.ticket_url || event.link || eventUrl,
		availability: 'https://schema.org/InStock'
	};

	return {
		'@context': 'https://schema.org',
		'@type': 'Event',
		name: event.name,
		description,
		startDate: event.time_tba
			? new Date(event.starts_at).toLocaleDateString('en-CA', { timeZone: BA_TIMEZONE })
			: event.starts_at,
		endDate: event.time_tba ? undefined : event.ends_at || undefined,
		eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
		eventStatus: 'https://schema.org/EventScheduled',
		image: imageUrl,
		url: eventUrl,
		location,
		offers
	};
}
