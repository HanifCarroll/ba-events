import { describe, expect, it } from 'vitest'
import type { CanonicalChatEventPayload, CanonicalChatResponse } from '#shared/lib/types.ts'
import { renderTelegramMessage } from './render.ts'

function event(index: number): CanonicalChatEventPayload {
  return {
    id: `event ${index}`,
    name: `**Tango <b>${index}</b>** ${'night '.repeat(60)}`,
    starts_at: '2026-01-15T20:30:00.000Z',
    is_all_day: false,
    time_tba: false,
    venue_name: 'Palermo',
    venue_neighborhood: 'Palermo',
    venue_address: null,
    location_hidden: false,
    is_free: index === 0,
    price: index === 0 ? 0 : 12_000,
    ticket_url: index === 0 ? 'http://unsafe.example/tickets' : 'https://tickets.example/buy',
    description_summary_en: 'A relaxed neighborhood dance night.',
    description_summary_es: null,
    description_unavailable: false,
    link: index === 0 ? 'https://events.example/tango' : null,
    saved: null,
  } as CanonicalChatEventPayload
}

function response(overrides: Partial<CanonicalChatResponse> = {}): CanonicalChatResponse {
  return {
    contractVersion: 5,
    requestId: 'request-1',
    kind: 'recommendations',
    messageKey: 'recommendations',
    text: '**Choices** <script>alert(1)</script>',
    events: Array.from({ length: 6 }, (_, index) => event(index)),
    directions: { venueName: 'Venue', address: 'Street', mapsUrl: 'https://maps.example/route' },
    venue: {
      venueId: 'venue-1',
      venueName: 'Venue',
      neighborhood: 'Palermo',
      address: 'Street',
      website: 'https://venue.example',
      instagram: '@venue.ba',
    },
    operations: [],
    suggestions: [],
    clarificationQuestions: [],
    provenance: {
      sourceToolCallIds: [],
      directionToolCallIds: [],
      venueToolCallIds: [],
      mutationToolCallIds: [],
      suggestionToolCallIds: [],
      emptySourceToolCallIds: [],
      retainedSourceToolCallIds: [],
      stageIds: [],
      searchAttemptToolCallIds: [],
      searchIncomplete: false,
      origin: 'validated',
      fallbackUsed: false,
      fallbackReason: null,
    },
    ...overrides,
  }
}

describe('Telegram canonical renderer', () => {
  it('renders one bounded plain-text message with at most five events', () => {
    const rendered = renderTelegramMessage(response(), 'en')

    expect(rendered.text.length).toBeLessThanOrEqual(4096)
    expect(rendered.text).not.toMatch(/<[^>]+>|[*_`~]/)
    expect(rendered.text).toContain('5. Tango 4')
    expect(rendered.text).not.toContain('6. Tango 5')
    expect(renderTelegramMessage(response(), 'en')).toEqual(rendered)
  })

  it('uses warm localized fallback framing when persisted framing is absent or invalid', () => {
    const rendered = renderTelegramMessage(response({ text: 'Tango 0 is the perfect event for you.' }), 'en')

    expect(rendered.text.startsWith('I found 5 options that could work well for this.')).toBe(true)
    expect(rendered.text).not.toContain('Tango 0 is the perfect event for you.')
    expect(rendered.text).toContain('Want details on one, or should I help you narrow it down?')
    const spanish = renderTelegramMessage(response({ text: 'Tango 0 es ideal para vos.' }), 'es').text
    expect(spanish.startsWith('Encontré 5 opciones que pueden ir bien para este plan.')).toBe(true)
    expect(spanish).toContain('¿Querés que te cuente más de alguna o te ayudo a elegir?')
  })

  it('uses singular fallback wording without plural narrowing language', () => {
    const rendered = renderTelegramMessage(response({ events: [event(0)] }), 'en').text
    expect(rendered).toContain('I found an option that could work well for this.')
    expect(rendered).toContain('Want details on it, or should I help with directions?')
    expect(rendered).not.toContain('narrow it down')
  })

  it('places accepted framing around the trusted event list', () => {
    const rendered = renderTelegramMessage(response({
      framing: { acknowledgement: 'I found a few options for your night out.', nextStep: 'Want me to help with details or directions?' },
    }), 'en').text
    expect(rendered.indexOf('I found a few options')).toBeLessThan(rendered.indexOf('1.'))
    expect(rendered.lastIndexOf('Want me to help')).toBeGreaterThan(rendered.lastIndexOf('5.'))
  })

  it('preserves prose paragraphs and bullets for non-recommendation responses', () => {
    const rendered = renderTelegramMessage(response({
      kind: 'event_details',
      text: 'Tango 0 is tonight.\n\n- Doors open at 8\n- Bring cash\n\n<em>Enjoy the show.</em>',
    }), 'en')

    expect(rendered.text).toContain('Tango 0 is tonight.\n\n- Doors open at 8\n- Bring cash\n\nEnjoy the show.')
    expect(rendered.text).not.toMatch(/\n{3,}/)
  })

  it('prefers a contextual recommendation reason over stored summaries', () => {
    const rendered = renderTelegramMessage(response({
      events: [{ ...event(1), recommendation_reason: 'This matches your request for a relaxed night.' }],
    }), 'en').text

    expect(rendered).toContain('This matches your request for a relaxed night.')
    expect(rendered).not.toContain('A relaxed neighborhood dance night.')
  })

  it('falls back to the requested locale summary when no reason exists', () => {
    const rendered = renderTelegramMessage(response({ events: [{
      ...event(1),
      description_summary_en: 'English stored summary.',
      description_summary_es: 'Resumen guardado en español.',
    }] }), 'es').text

    expect(rendered).toContain('Resumen guardado en español.')
    expect(rendered).not.toContain('English stored summary.')
  })

  it('does not cross-language fallback description lines', () => {
    const rendered = renderTelegramMessage(response({ events: [event(1)] }), 'es').text

    expect(rendered).not.toContain('A relaxed neighborhood dance night.')
    expect(rendered).toContain('1. Tango 1')
  })

  it('formats in the requested locale and Buenos Aires time zone', () => {
    const canonical = response({ events: [event(1)] })
    const english = renderTelegramMessage(canonical, 'en').text
    const spanish = renderTelegramMessage(canonical, 'es').text

    expect(english).toContain('Thu, Jan 15 · 5:30 PM')
    expect(english).toContain('ARS 12,000')
    expect(english).toContain('A relaxed neighborhood dance night.')
    expect(spanish).toContain('jue, 15 ene · 17:30')
    expect(spanish).toContain('ARS 12.000')
  })

  it('keeps recommendation picks decisive and renders one event card', () => {
    const rendered = renderTelegramMessage(response({
      messageKey: 'recommendations_pick',
      events: [event(0)],
      text: 'The top pick is Tango 0; alternatively consider another event.',
    }), 'en')
    expect(rendered.text).toContain('My top pick:')
    expect(rendered.text).not.toContain('alternatively')
    expect(rendered.text.match(/^1\./m)).toHaveLength(1)
  })

  it('uses one sanitized named BA Eventos button per event', () => {
    const rendered = renderTelegramMessage(response(), 'en')
    const buttons = rendered.replyMarkup?.inline_keyboard.flat() ?? []
    const eventButtons = buttons.filter((button) => button.url?.startsWith('https://baeventos.com/events/'))

    expect(eventButtons).toHaveLength(5)
    expect(eventButtons.every((button) => button.text.length <= 64 && !button.text.includes('↗'))).toBe(true)
    expect(eventButtons[0]).toMatchObject({
      text: expect.stringMatching(/^1 · Tango 0 night /),
      url: 'https://baeventos.com/events/event%200',
    })
    expect(buttons.some((button) => button.text === 'Details' || button.text === 'Tickets / event page')).toBe(false)
    expect(buttons.some((button) => button.url === 'https://events.example/tango')).toBe(false)
    expect(buttons.some((button) => button.url === 'https://maps.example/route')).toBe(true)
    expect(buttons.some((button) => button.url === 'https://venue.example/')).toBe(true)
    expect(buttons.some((button) => button.url === 'https://www.instagram.com/venue.ba')).toBe(true)
  })

  it.each([
    ['baeventos', 'https://www.instagram.com/baeventos'],
    ['https://instagram.com/baeventos/', 'https://instagram.com/baeventos/'],
  ])('accepts safe Instagram value %s', (instagram, expected) => {
    const canonical = response({ venue: { ...response().venue!, instagram } })
    const buttons = renderTelegramMessage(canonical, 'en').replyMarkup?.inline_keyboard.flat() ?? []

    expect(buttons.some((button) => button.url === expected)).toBe(true)
  })

  it('rejects non-Instagram and insecure Instagram venue links', () => {
    for (const instagram of ['http://instagram.com/venue', 'https://instagram.com.evil.test/venue']) {
      const canonical = response({ venue: { ...response().venue!, instagram } })
      const buttons = renderTelegramMessage(canonical, 'en').replyMarkup?.inline_keyboard.flat() ?? []
      expect(buttons.filter((button) => button.text === 'Instagram')).toHaveLength(0)
    }
  })

  it('renders channel-safe share guidance from the canonical semantic key', () => {
    const rendered = renderTelegramMessage(response({
      kind: 'out_of_scope',
      messageKey: 'share_guidance',
      text: 'Use the share button on the event card.',
      events: [],
    }), 'en')

    expect(rendered.text).toContain('Open the event link')
    expect(rendered.text).not.toContain('web card')
    expect(rendered.text).not.toContain('share button')
  })

  it('replaces web-only saved-event instructions for the pilot', () => {
    const en = renderTelegramMessage(response({ messageKey: 'use_save_control' }), 'en').text
    const es = renderTelegramMessage(response({ messageKey: 'login_required' }), 'es').text

    expect(en).toContain("isn't available in Telegram")
    expect(en).not.toContain('heart')
    expect(es).toContain('no están vinculados con Telegram')
  })
})
