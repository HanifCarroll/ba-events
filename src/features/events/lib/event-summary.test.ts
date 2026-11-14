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
		name: 'Jazz Night at Niceto',
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
		venue_id: null,
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
		venue_name: 'Niceto Club',
		venue_neighborhood: 'Palermo',
		venue_address: 'Av. Cnel. Niceto Vega 5510',
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

describe('buildEventJsonLd', () => {
	it('emits Event structured data with a free offer and venue address', () => {
		const jsonLd = buildEventJsonLd(makeEvent(), 'https://baeventos.com/events/evt-1', '/og-image.png');

		expect(jsonLd['@type']).toBe('Event');
		expect(jsonLd.name).toBe('Jazz Night at Niceto');
		expect(jsonLd.url).toBe('https://baeventos.com/events/evt-1');
		expect(jsonLd.location).toEqual({
			'@type': 'Place',
			name: 'Niceto Club',
			address: {
				'@type': 'PostalAddress',
				addressLocality: 'Buenos Aires',
				addressCountry: 'AR',
				streetAddress: 'Av. Cnel. Niceto Vega 5510'
			}
		});
		expect(jsonLd.offers.price).toBe('0');
		expect(jsonLd.offers.priceCurrency).toBe('ARS');
	});

	it('omits the street address when the location is hidden', () => {
		const jsonLd = buildEventJsonLd(
			makeEvent({ location_hidden: true }),
			'https://baeventos.com/events/evt-1',
			'/og-image.png'
		);

		expect(jsonLd.location.address.streetAddress).toBeUndefined();
	});
});
