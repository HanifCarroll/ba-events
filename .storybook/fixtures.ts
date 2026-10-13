import type { User } from '@supabase/supabase-js';
import type { ChatMessage, EventWithVenue } from '#shared/lib/types.ts';

export type Locale = 'es' | 'en';
export const fixtureLocale = (value: unknown): Locale => value === 'en' ? 'en' : 'es';

// Synthetic data only. Dates and image URLs are fixed so stories stay reproducible.
export const eventFixture: EventWithVenue = {
	id: '00000000-0000-4000-8000-000000000001', name: 'Jazz en San Telmo',
	description_es: 'Una noche de jazz en vivo con un trío local.',
	description_en: 'An evening of live jazz with a local trio.',
	description_display_es: 'Una noche de jazz en vivo con un trío local.',
	description_display_en: 'An evening of live jazz with a local trio.',
	description_summary_es: 'Jazz en vivo en un espacio íntimo de San Telmo.',
	description_summary_en: 'Live jazz in an intimate San Telmo venue.',
	starts_at: '2026-11-14T00:00:00Z', ends_at: '2026-11-14T03:00:00Z',
	is_all_day: false, time_tba: false, venue_id: '00000000-0000-4000-8000-000000000010',
	venue_name: 'Club del Sur', venue_neighborhood: 'San Telmo', venue_address: 'Defensa 1000',
	categories: ['music'], price: 12000, is_free: false, min_age: null,
	image_url: '/fixtures/poster-portrait.svg', image_width: 480, image_height: 720,
	link: 'https://example.com/events/jazz', ticket_url: 'https://example.com/tickets/jazz',
	source: 'eventbrite', external_id: 'storybook-jazz', status: 'scheduled',
	location_hidden: false, location_tba: false, description_unavailable: false,
	enrichment_status: 'completed', enrichment_error: null, enriched_at: '2026-10-13T15:00:00Z',
	facets: { eventType: ['concert'], genres: ['jazz'], activities: ['live-music'], vibes: ['intimate'], audience: [], setting: ['indoor'] },
	created_at: '2026-10-13T15:00:00Z', updated_at: '2026-10-13T15:00:00Z'
};

export function makeEvent(overrides: Partial<EventWithVenue> = {}): EventWithVenue {
	return structuredClone({ ...eventFixture, ...overrides });
}

export const fixtureUser: User = {
	id: '00000000-0000-4000-8000-000000000099', aud: 'authenticated',
	app_metadata: {}, user_metadata: {}, created_at: '2026-10-13T15:00:00Z'
};

const translations = [
	['¿Qué hay para hacer este fin de semana?', 'What is happening this weekend?'],
	['**Jazz en vivo**\n\nUn plan para el viernes:\n- Música en San Telmo\n- Entradas disponibles', '**Live jazz**\n\nA plan for Friday:\n- Music in San Telmo\n- Tickets available'],
	['Encontré algunas opciones para vos…', 'I found a few options for you…'],
	['Estas opciones van con lo que buscás.', 'These options fit what you are looking for.'],
	['¿Qué día preferís?', 'Which day do you prefer?'],
	['Un espacio íntimo para escuchar jazz con amigos.', 'An intimate place to enjoy jazz with friends.'],
	['Llegá unos minutos antes para elegir una buena mesa.', 'Arrive a few minutes early to choose a good table.'],
	['Solo gratis', 'Free only'],
	['Mostrame solo eventos gratuitos.', 'Show me only free events.'],
	['Evento guardado.', 'Event saved.'],
	['No se pudo guardar el evento.', 'The event could not be saved.']
] as const;

/** Translate known fixture text while preserving arbitrary edits in Controls. */
export function localizeText(text: string, locale: Locale): string {
	const pair = translations.find(([es, en]) => text === es || text === en);
	return pair ? pair[locale === 'en' ? 1 : 0] : text;
}

export function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
	return structuredClone({
		id: 'storybook-message', role: 'assistant',
		content: translations[1][0], timestamp: new Date('2026-11-13T21:00:00-03:00'),
		isStreaming: false, ...overrides
	});
}

export function localizeMessage(message: ChatMessage, locale: Locale): ChatMessage {
	const result = structuredClone(message);
	result.content = localizeText(result.content, locale);
	result.suggestions = result.suggestions?.map((suggestion) => ({
		...suggestion, label: localizeText(suggestion.label, locale), prompt: localizeText(suggestion.prompt, locale)
	}));
	result.clarificationQuestions = result.clarificationQuestions?.map((question) => ({
		...question, label: localizeText(question.label, locale)
	}));
	result.operations = result.operations?.map((receipt) => ({ ...receipt, message: localizeText(receipt.message, locale) }));
	return result;
}

export const suggestionFixture = {
	id: 'free', label: 'Solo gratis', prompt: 'Mostrame solo eventos gratuitos.', type: 'price', icon: 'ticket'
} as const;

export const clarificationFixture = { key: 'which_day', label: '¿Qué día preferís?' } as const;
