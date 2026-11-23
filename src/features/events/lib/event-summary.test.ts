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
	it('emits only known details, including the recorded end, location, and ticket price', () => {
		const jsonLd = jsonLdFor({ ends_at: '2026-08-15T21:00:00-03:00', is_free: false, price: 9000 });
		expect(JSON.parse(JSON.stringify(jsonLd))).toEqual({
			'@context': 'https://schema.org',
			'@type': 'Event',
			name: 'Jazz Night at Sala Nube',
			description: 'Intimate jazz night in Palermo.',
			url: 'https://baeventos.com/events/evt-1',
			image: 'https://baeventos.com/flyer.jpg',
			startDate: '2026-08-15T19:00:00-03:00',
			endDate: '2026-08-15T21:00:00-03:00',
			eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
			eventStatus: 'https://schema.org/EventScheduled',
			location: {
				'@type': 'Place', name: 'Sala Nube',
				address: { '@type': 'PostalAddress', addressLocality: 'Buenos Aires', addressCountry: 'AR', streetAddress: 'Calle Falsa 123' }
			},
			offers: {
				'@type': 'Offer', url: 'https://example.com/jazz', availability: 'https://schema.org/InStock',
				price: 9000, priceCurrency: 'ARS'
			}
		});
	});

	it('does not invent an end time or price', () => {
		const jsonLd = jsonLdFor({ is_free: false });
		expect(jsonLd.endDate).toBeUndefined();
		expect(jsonLd.offers).toEqual({
			'@type': 'Offer', url: 'https://example.com/jazz', availability: 'https://schema.org/InStock'
		});
	});

	it.each([{ time_tba: true }, { is_all_day: true }])('uses Buenos Aires dates and omits an unknown end for %j', (flags) => {
		const fields = { ...flags, starts_at: '2026-08-16T01:00:00Z' };
		const jsonLd = jsonLdFor(fields);
		expect(jsonLd.startDate).toBe('2026-08-15');
		expect(JSON.parse(JSON.stringify(jsonLd))).not.toHaveProperty('endDate');
		expect(jsonLdFor({ ...fields, ends_at: '2026-08-17T01:00:00Z' }).endDate).toBe('2026-08-16');
	});

	it.each([
		{ basis: 'the free flag', price: null, is_free: true, expectedPrice: 0 },
		{ basis: 'a zero price', price: 0, is_free: false, expectedPrice: 0 },
		{ basis: 'a paid price', price: 9000, is_free: false, expectedPrice: 9000 }
	])('uses the event page without a ticket link when admission is known from $basis', ({ price, is_free, expectedPrice }) => {
		const jsonLd = jsonLdFor({ price, is_free, ticket_url: null });
		expect(jsonLd.isAccessibleForFree).toBe(expectedPrice === 0 ? true : undefined);
		expect(jsonLd.offers).toEqual({
			'@type': 'Offer', url: jsonLd.url, availability: 'https://schema.org/InStock',
			price: expectedPrice, priceCurrency: 'ARS'
		});
	});

	it('omits an offer when admission is unknown and there is no usable ticket link', () => {
		const jsonLd = jsonLdFor({ is_free: false, ticket_url: '  ' });
		expect(jsonLd.isAccessibleForFree).toBeUndefined();
		expect(jsonLd.offers).toBeUndefined();
	});

	it('does not use the BA Tourism info page as a ticket link', () => {
		const jsonLd = jsonLdFor({ source: 'ba-tourism' });
		expect(jsonLd.offers?.url).toBe(jsonLd.url);
		expect(jsonLdFor({ source: 'ba-tourism', is_free: false }).offers).toBeUndefined();
	});

	it('preserves explicit hours on Luma events spanning multiple days', () => {
		const start = '2026-08-15T03:00:00.000Z', end = '2026-08-16T17:30:00.000Z';
		expect(jsonLdFor({ source: 'luma', is_all_day: true, starts_at: start, ends_at: end }))
			.toMatchObject({ startDate: start, endDate: end });
	});

	it('keeps the ticket URL without claiming a contribution is free or fixed-price', () => {
		const admission = { description_es: 'Entrada a la go\u0301rra.', is_free: true, price: 0 };
		const jsonLd = jsonLdFor(admission);
		expect(jsonLd.isAccessibleForFree).toBeUndefined();
		expect(jsonLd.offers).toEqual({
			'@type': 'Offer', url: 'https://example.com/jazz', availability: 'https://schema.org/InStock'
		});
		expect(jsonLdFor({ ...admission, ticket_url: null }).offers).toBeUndefined();
	});

	it('omits a hidden, unconfirmed, or absent venue from location markup', () => {
		for (const fields of [{ location_hidden: true }, { location_tba: true }, { venue_id: null, venue_name: null, venue_address: null }]) {
			const location = JSON.stringify(jsonLdFor(fields).location);
			expect(location).not.toContain('"name":');
			expect(location).not.toContain('"streetAddress":');
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

	it('includes an offer for a postponed event', () => {
		expect(jsonLdFor({ status: 'postponed' }).offers).toEqual({
			'@type': 'Offer', url: 'https://example.com/jazz', availability: 'https://schema.org/InStock',
			price: 0, priceCurrency: 'ARS'
		});
	});

	it.each(['past', 'canceled', 'pending_review'] as const)('omits offers for %s events', (status) => {
		expect(JSON.parse(JSON.stringify(jsonLdFor({ status, price: 9000, is_free: false }))))
			.not.toHaveProperty('offers');
	});
});
