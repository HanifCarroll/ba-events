import { describe, expect, it } from 'vitest';
import {
	buildEventJsonLd,
	buildEventSummary,
	formatCategoryLabel
} from './event-summary.ts';
import type { EventWithVenue } from '#shared/lib/types.ts';
import { EMPTY_FACETS } from '#shared/lib/search-facets.ts';

function makeEvent(overrides: Partial<EventWithVenue> = {}): EventWithVenue {
	return {
		id: 'evt-1',
		name: 'Jazz Night at Sala Nube',
		description_es: null,
		description_en: null,
		description_display_es: null,
		description_display_en: null,
		description_summary_es: 'Noche de jazz íntima en Palermo.',
		description_summary_en: 'Intimate jazz night in Palermo.',
		starts_at: '2026-08-15T19:00:00-03:00',
		ends_at: null,
		is_all_day: false,
		time_tba: false,
		venue_id: 'venue-1',
		categories: ['music'],
		price: null,
		is_free: true,
		min_age: null,
		image_url: null,
		link: 'https://example.com/jazz',
		ticket_url: 'https://example.com/jazz',
		source: 'meetup',
		external_id: null,
		status: 'scheduled',
		location_hidden: false,
		location_tba: false,
		description_unavailable: false,
		enrichment_status: 'completed',
		enrichment_error: null,
		enriched_at: null,
		facets: EMPTY_FACETS,
		created_at: '2026-08-01T00:00:00Z',
		updated_at: '2026-08-01T00:00:00Z',
		venue_name: 'Sala Nube',
		venue_neighborhood: 'Palermo',
		venue_address: 'Calle Falsa 123',
		venue_website: 'https://salanube.example',
		...overrides
	};
}

describe('formatCategoryLabel', () => {
	it('turns category slugs into title-case labels', () => {
		expect(formatCategoryLabel('music')).toBe('Music');
		expect(formatCategoryLabel('live-music')).toBe('Live Music');
		expect(formatCategoryLabel('ba_tourism')).toBe('Ba Tourism');
	});
});

describe('buildEventSummary', () => {
	it('uses the locale-aware summary when present', () => {
		expect(buildEventSummary(makeEvent(), 'en')).toBe('Intimate jazz night in Palermo.');
		expect(buildEventSummary(makeEvent(), 'es')).toBe('Noche de jazz íntima en Palermo.');
	});

	it('falls back to the neighborhood then to the city', () => {
		const noSummary = makeEvent({ description_summary_en: null, description_summary_es: null });
		expect(buildEventSummary(noSummary, 'en')).toBe('Event in Palermo');

		const noNeighborhood = makeEvent({
			description_summary_en: null,
			description_summary_es: null,
			venue_neighborhood: null
		});
		expect(buildEventSummary(noNeighborhood, 'en')).toBe('Event in Buenos Aires');
	});

	it('truncates to 160 characters', () => {
		const long = 'a'.repeat(300);
		const summary = buildEventSummary(
			makeEvent({ description_summary_en: long, description_summary_es: null }),
			'en'
		);
		expect(summary.length).toBeLessThanOrEqual(160);
		expect(summary.endsWith('...')).toBe(true);
	});
});

const jsonLdFor = (overrides: Partial<EventWithVenue> = {}) =>
	buildEventJsonLd(makeEvent(overrides), 'https://baeventos.com/events/evt-1', 'https://baeventos.com/flyer.jpg');

describe('buildEventJsonLd', () => {
	it('uses the recorded end, venue organizer, and known ticket price', () => {
		const jsonLd = jsonLdFor({ ends_at: '2026-08-15T21:00:00-03:00', is_free: false, price: 9000 });
		expect(jsonLd).toMatchObject({
			'@type': 'Event',
			name: 'Jazz Night at Sala Nube',
			url: 'https://baeventos.com/events/evt-1',
			startDate: '2026-08-15T19:00:00-03:00',
			endDate: '2026-08-15T21:00:00-03:00',
			eventStatus: 'https://schema.org/EventScheduled',
			organizer: { '@type': 'Organization', name: 'Sala Nube', url: 'https://salanube.example' },
			location: {
				'@type': 'Place', name: 'Sala Nube',
				address: { '@type': 'PostalAddress', addressLocality: 'Buenos Aires', addressCountry: 'AR', streetAddress: 'Calle Falsa 123' }
			}
		});
		expect(jsonLd.offers).toEqual({ '@type': 'Offer', url: 'https://example.com/jazz', price: 9000, priceCurrency: 'ARS' });
		expect(jsonLd).not.toHaveProperty('performer');
	});

	it('does not invent an end time, price, or organizer URL', () => {
		const jsonLd = jsonLdFor({ is_free: false, venue_website: null });
		expect(jsonLd.endDate).toBeUndefined();
		expect(jsonLd.organizer).toMatchObject({ '@type': 'Organization', name: 'Sala Nube' });
		expect(jsonLd.organizer?.url).toBeUndefined();
		expect(jsonLd.offers).toEqual({ '@type': 'Offer', url: 'https://example.com/jazz' });
	});

	it('uses Buenos Aires dates when no hours are known and makes no offer without an admission URL', () => {
		const jsonLd = jsonLdFor({ time_tba: true, starts_at: '2026-08-16T01:00:00Z', ticket_url: null });
		expect(jsonLd).toMatchObject({ startDate: '2026-08-15', endDate: '2026-08-15', isAccessibleForFree: true });
		expect(jsonLd.offers).toBeUndefined();
		expect(jsonLdFor({ source: 'ba-tourism' }).offers).toBeUndefined();
		expect(jsonLdFor().offers?.price).toBe(0);
		expect(jsonLdFor({ is_all_day: true, ends_at: '2026-08-17T02:00:00Z' }).endDate).toBe('2026-08-16');
	});

	it('omits a hidden, unconfirmed, or absent venue from location and organizer markup', () => {
		for (const fields of [{ location_hidden: true }, { location_tba: true }, { venue_id: null, venue_name: null, venue_address: null }]) {
			const jsonLd = jsonLdFor(fields);
			const encoded = JSON.stringify(jsonLd);
			const location = JSON.stringify(jsonLd.location);
			expect(location).not.toContain('"name":');
			expect(location).not.toContain('"streetAddress":');
			expect(encoded).not.toContain('"organizer":');
			expect(encoded).not.toContain('salanube.example');
		}
	});

	it('preserves the original date and location when an event is canceled or postponed', () => {
		for (const [status, schemaStatus] of [['canceled', 'EventCancelled'], ['postponed', 'EventPostponed']] as const) {
			const jsonLd = jsonLdFor({ status });
			expect(jsonLd.eventStatus).toBe(`https://schema.org/${schemaStatus}`);
			expect(jsonLd.startDate).toBe(jsonLdFor().startDate);
			expect(jsonLd.location).toEqual(jsonLdFor().location);
		}
	});
});
