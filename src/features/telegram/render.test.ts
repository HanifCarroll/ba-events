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

  it('replaces recommendation prose with a localized deterministic lead', () => {
    const rendered = renderTelegramMessage(response({ text: 'Tango 0 is the perfect event for you.' }), 'en')

    expect(rendered.text.startsWith('Here are 5 events:')).toBe(true)
    expect(renderTelegramMessage(response(), 'es').text.startsWith('Acá tenés 5 eventos:')).toBe(true)
    expect(rendered.text).not.toContain('Tango 0 is the perfect event for you.')
    expect(rendered.text.match(/Tango 0/g)).toHaveLength(1)
    expect(rendered.text).toContain('Would you like more details or directions for any of them?')
    const spanish = renderTelegramMessage(response({ text: 'Tango 0 es ideal para vos.' }), 'es').text
    expect(spanish).toContain('¿Querés más detalles o indicaciones sobre alguno?')
    expect(spanish.match(/Tango 0/g)).toHaveLength(1)
  })

  it('preserves prose paragraphs and bullets for non-recommendation responses', () => {
    const rendered = renderTelegramMessage(response({
      kind: 'event_details',
      text: 'Tango 0 is tonight.\n\n- Doors open at 8\n- Bring cash\n\n<em>Enjoy the show.</em>',
    }), 'en')

    expect(rendered.text).toContain('Tango 0 is tonight.\n\n- Doors open at 8\n- Bring cash\n\nEnjoy the show.')
    expect(rendered.text).not.toMatch(/\n{3,}/)
  })

  it('formats in the requested locale and Buenos Aires time zone', () => {
    const canonical = response({ events: [event(1)] })
    const english = renderTelegramMessage(canonical, 'en').text
    const spanish = renderTelegramMessage(canonical, 'es').text

    expect(english).toContain('Jan 15, 2026 · 05:30 PM')
    expect(english).toContain('ARS 12,000')
    expect(spanish).toContain('15 ene 2026 · 17:30')
    expect(spanish).toContain('$ 12.000')
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
