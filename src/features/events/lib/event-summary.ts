import { BA_TIMEZONE } from '#shared/lib/constants.ts';
import { pickDescriptionSummary } from '#features/events/lib/description-presentation.ts';
import { isPayWhatYouCan } from '#features/events/lib/admission.ts';
import type { EventWithVenue } from '#shared/lib/types.ts';
import { normalizeText } from '#shared/lib/utils/normalize-text.ts';

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
	const contribution = event.payWhatYouCan ?? isPayWhatYouCan(event.name, event.description_es);
	const isFree = !contribution && (event.is_free || event.price === 0);
	const showVenue = !event.location_hidden && !event.location_tba;
	const venueName = showVenue ? event.venue_name?.trim() || undefined : undefined;
	// Luma uses is_all_day for long events with actual start and end times.
	const dateOnly = event.time_tba || (event.is_all_day && event.source !== 'luma');
	const localDate = (value: string) => new Date(value).toLocaleDateString('en-CA', { timeZone: BA_TIMEZONE });
	const startDate = dateOnly ? localDate(event.starts_at) : event.starts_at;
	const endDate = event.ends_at
		? (dateOnly ? localDate(event.ends_at) : event.ends_at)
		: (dateOnly ? startDate : undefined);
	const status = {
		scheduled: 'EventScheduled', past: 'EventScheduled', canceled: 'EventCancelled',
		postponed: 'EventPostponed', pending_review: undefined
	}[event.status];

	// BA Tourism copies its info page into ticket_url even when it isn't an admission link.
	const ticketUrl = event.source !== 'ba-tourism' && event.ticket_url?.trim();
	const price = contribution ? undefined : (isFree ? 0 : event.price);
	const creditedOrganizer = event.organizer_name?.trim();
	const organizerName = creditedOrganizer || venueName;
	const organizerUrl = creditedOrganizer ? event.organizer_url : event.venue_website;
	const descriptions = ` ${normalizeText([event.description_es, event.description_en].join(' '))} `;
	const performer = event.performers?.map(({ name, url }) => {
		const label = normalizeText(name);
		const soloist = label && ['solista', 'soloist'].some(role => descriptions.includes(` ${role} ${label} `));
		return { '@type': soloist ? 'Person' : 'PerformingGroup', name, ...(url ? { url } : {}) };
	});

	return {
		'@context': 'https://schema.org',
		'@type': 'Event',
		name: event.name,
		description: buildEventSummary(event),
		startDate,
		endDate,
		...(event.doors_at ? { doorTime: event.doors_at } : {}),
		eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
		eventStatus: status ? `https://schema.org/${status}` : undefined,
		image: imageUrl,
		url: eventUrl,
		location: {
			'@type': 'Place',
			name: venueName,
			address: {
				'@type': 'PostalAddress',
				addressLocality: 'Buenos Aires',
				addressCountry: 'AR',
				streetAddress: showVenue ? event.venue_address?.trim() || undefined : undefined
			}
		},
		organizer: organizerName ? {
			'@type': 'Organization', name: organizerName, url: organizerUrl?.trim() || undefined
		} : undefined,
		...(performer?.length ? { performer } : {}),
		isAccessibleForFree: isFree || undefined,
		offers: ticketUrl ? {
			'@type': 'Offer', url: ticketUrl,
			...(event.offers_valid_from ? { validFrom: event.offers_valid_from } : {}),
			...(price != null ? { price, priceCurrency: 'ARS' } : {})
		} : undefined
	};
}
