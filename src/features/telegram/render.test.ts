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

  it('formats in the requested locale and Buenos Aires time zone', () => {
    const canonical = response({ events: [event(1)] })
    const english = renderTelegramMessage(canonical, 'en').text
    const spanish = renderTelegramMessage(canonical, 'es').text

    expect(english).toContain('Jan 15, 2026 · 05:30 PM')
    expect(english).toContain('ARS 12,000')
    expect(spanish).toContain('15 ene 2026 · 17:30')
    expect(spanish).toContain('$ 12.000')
  })

  it('keeps only HTTPS buttons and always uses BA Eventos detail links', () => {
    const rendered = renderTelegramMessage(response(), 'en')
    const buttons = rendered.replyMarkup?.inline_keyboard.flat() ?? []

    expect(buttons.every((button) => button.url?.startsWith('https://'))).toBe(true)
    expect(buttons.some((button) => button.url === 'http://unsafe.example/tickets')).toBe(false)
    expect(buttons.some((button) => button.url === 'https://events.example/tango')).toBe(true)
    expect(buttons.some((button) => button.url === 'https://baeventos.com/events/event%200')).toBe(true)
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

  it('replaces web-only saved-event instructions for the pilot', () => {
    const en = renderTelegramMessage(response({ messageKey: 'use_save_control' }), 'en').text
    const es = renderTelegramMessage(response({ messageKey: 'login_required' }), 'es').text

    expect(en).toContain("isn't available in Telegram")
    expect(en).not.toContain('heart')
    expect(es).toContain('no están vinculados con Telegram')
  })
})
