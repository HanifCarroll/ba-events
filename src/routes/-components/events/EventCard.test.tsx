import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { fireEvent, render, waitFor, within } from '@testing-library/react'
import { EventCard } from './EventCard'
import type { EventWithVenue } from '@/shared/lib/types'
import { EMPTY_FACETS } from '@/shared/lib/search-facets'
import * as m from '@/paraglide/messages'

// Bun's test runner has no DOM: bootstrap jsdom globals manually.
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  pretendToBeVisual: true,
})
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  getComputedStyle: dom.window.getComputedStyle,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  MutationObserver: dom.window.MutationObserver,
})
// Node 21+ defines a read-only navigator global; replace it for this suite.
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
})

vi.mock('@/lib/analytics', () => ({
  track: vi.fn(),
}))

vi.mock('@/features/auth/hooks/useAuthContext', () => ({
  useAuthContext: () => ({
    user: { id: 'test-user' },
    loading: false,
    isAdmin: false,
    signOut: vi.fn(),
  }),
}))

vi.mock('@/features/chat/lib/saved', () => ({
  isEventSaved: vi.fn().mockResolvedValue(false),
  saveEvent: vi.fn().mockResolvedValue(undefined),
  unsaveEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, onClick, ...props }: Record<string, unknown>) => (
    <a href="#" onClick={onClick as () => void} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}))

import { track } from '@/lib/analytics'

function makeEvent(overrides: Partial<EventWithVenue> = {}): EventWithVenue {
  return {
    id: 'evt-1',
    name: 'Jazz Night at Niceto',
    description_es: null,
    description_en: null,
    description_display_es: null,
    description_display_en: null,
    description_summary_es: 'Intimate jazz night in Palermo.',
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
    ...overrides,
  }
}

function desktopCard(): HTMLElement {
  const articles = document.querySelectorAll('article')
  // DefaultEventCard renders mobile first, then the desktop variant.
  return articles[articles.length - 1] as HTMLElement
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DesktopEventCard', () => {
  it('renders the compact row: title, price, fact line, summary and context', () => {
    const event = makeEvent()
    render(<EventCard event={event} position={0} source="chat" />)

    const card = desktopCard()
    expect(within(card).getByText('Jazz Night at Niceto')).toBeTruthy()
    expect(within(card).getByText(m.event_free())).toBeTruthy()
    // One concise fact line: date · time · place
    expect(within(card).getByText('Niceto Club')).toBeTruthy()
    // Summary and quiet context (source + category)
    expect(within(card).getByText('Intimate jazz night in Palermo.')).toBeTruthy()
    expect(within(card).getByText('Meetup')).toBeTruthy()
    expect(within(card).getByText('music')).toBeTruthy()
  })

  it('renders labeled actions: save, share, details and the external CTA', () => {
    render(<EventCard event={makeEvent()} position={0} source="chat" />)

    const card = desktopCard()
    expect(within(card).getByText(m.event_save())).toBeTruthy()
    expect(within(card).getByText(m.event_share())).toBeTruthy()
    expect(within(card).getByText(m.event_details_short())).toBeTruthy()
    expect(within(card).getByText(m.event_rsvp_on({ source: 'Meetup' }))).toBeTruthy()
  })

  it('uses the semantic source action label: luma registers, ba-tourism views', () => {
    const { unmount } = render(
      <EventCard event={makeEvent({ source: 'luma' })} position={0} source="chat" />
    )
    expect(within(desktopCard()).getByText(m.event_register_on({ source: 'Luma' }))).toBeTruthy()
    unmount()

    render(<EventCard event={makeEvent({ source: 'ba-tourism' })} position={0} source="chat" />)
    expect(
      within(desktopCard()).getByText(m.event_view_on({ source: 'BA Tourism' }))
    ).toBeTruthy()
  })

  it('omits the external CTA when no external URL exists', () => {
    render(
      <EventCard event={makeEvent({ ticket_url: null, link: null })} position={0} source="chat" />
    )
    const card = desktopCard()
    expect(within(card).queryByText(m.event_rsvp_on({ source: 'Meetup' }))).toBeNull()
    expect(within(card).getByText(m.event_details_short())).toBeTruthy()
  })

  it('renders the external CTA as a quiet outlined link-button with preserved semantics', () => {
    render(<EventCard event={makeEvent()} position={0} source="chat" />)

    const cta = within(desktopCard())
      .getByText(m.event_rsvp_on({ source: 'Meetup' }))
      .closest('a') as HTMLAnchorElement

    // Anchor semantics, truthful source label, icon, target/rel are unchanged
    expect(cta.tagName).toBe('A')
    expect(cta.getAttribute('href')).toBe('https://example.com/jazz')
    expect(cta.getAttribute('target')).toBe('_blank')
    expect(cta.getAttribute('rel')).toBe('noopener noreferrer')
    expect(cta.querySelector('svg')).toBeTruthy()

    // Quiet outline treatment: outline variant, transparent at rest, restrained
    // indigo border/text, pale indigo hover, right-aligned, visible focus ring
    expect(cta.getAttribute('data-variant')).toBe('outline')
    expect(cta.className).toContain('bg-transparent')
    expect(cta.className).toContain('border-primary/40')
    expect(cta.className).toContain('text-primary')
    expect(cta.className).toContain('hover:bg-primary/10')
    expect(cta.className).toContain('ml-auto')
    expect(cta.className).toContain('focus-visible:ring')
  })

  it('shows limited info as quiet context when no summary exists', () => {
    render(
      <EventCard
        event={makeEvent({ description_summary_es: null, description_summary_en: null })}
        position={0}
        source="chat"
      />
    )
    expect(within(desktopCard()).getByText(m.event_limited_info())).toBeTruthy()
  })

  it('tracks the view on mount and details navigation', () => {
    render(<EventCard event={makeEvent()} position={2} source="chat" />)

    expect(track).toHaveBeenCalledWith('event:viewed', {
      event_id: 'evt-1',
      event_name: 'Jazz Night at Niceto',
      position: 2,
      source: 'chat',
    })

    fireEvent.click(within(desktopCard()).getByText(m.event_details_short()))
    expect(track).toHaveBeenCalledWith('chat:event_clicked', {
      event_id: 'evt-1',
      event_name: 'Jazz Night at Niceto',
      position: 2,
      source: 'chat',
    })
  })

  it('tracks external CTA clicks with the accurate link_type', () => {
    render(<EventCard event={makeEvent({ source: 'meetup' })} position={0} source="chat" />)

    fireEvent.click(within(desktopCard()).getByText(m.event_rsvp_on({ source: 'Meetup' })))
    expect(track).toHaveBeenCalledWith('event:link_clicked', {
      event_id: 'evt-1',
      event_name: 'Jazz Night at Niceto',
      link_type: 'rsvp',
    })

    vi.clearAllMocks()
    const { unmount } = render(
      <EventCard event={makeEvent({ source: 'passline' })} position={0} source="chat" />
    )
    fireEvent.click(within(desktopCard()).getByText(m.event_get_tickets_on({ source: 'Passline' })))
    expect(track).toHaveBeenCalledWith('event:link_clicked', {
      event_id: 'evt-1',
      event_name: 'Jazz Night at Niceto',
      link_type: 'ticket',
    })
    unmount()
  })

  it('shares localized venue-aware text via the native share API', async () => {
    const shareSpy = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis.navigator, 'share', {
      value: shareSpy,
      configurable: true,
    })
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })

    render(<EventCard event={makeEvent()} position={0} source="chat" />)
    fireEvent.click(within(desktopCard()).getByText(m.event_share()))

    await waitFor(() => {
      expect(shareSpy).toHaveBeenCalledWith({
        title: 'Jazz Night at Niceto',
        text: m.event_share_text_venue({ name: 'Jazz Night at Niceto', venue: 'Niceto Club' }),
        url: expect.any(String),
      })
    })
    expect(track).toHaveBeenCalledWith('event:shared', {
      event_id: 'evt-1',
      event_name: 'Jazz Night at Niceto',
      share_method: 'native',
    })
  })

  it('falls back to venue-less share text when the venue is unknown', async () => {
    const shareSpy = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis.navigator, 'share', {
      value: shareSpy,
      configurable: true,
    })

    render(<EventCard event={makeEvent({ venue_name: null })} position={0} source="chat" />)
    fireEvent.click(within(desktopCard()).getByText(m.event_share()))

    await waitFor(() => {
      expect(shareSpy).toHaveBeenCalled()
    })
    const text = shareSpy.mock.calls[0][0].text as string
    expect(text).toBe(m.event_share_text_no_venue({ name: 'Jazz Night at Niceto' }))
    expect(text).not.toMatch(/null|undefined/)
  })
})

// =============================================================================
// MobileEventCard
// =============================================================================

function renderMobileCard(event: EventWithVenue, source: 'chat' | 'saved_page' = 'chat') {
  const { container } = render(<EventCard event={event} source={source} />)
  // DefaultEventCard renders the mobile variant first inside its own container.
  return container.querySelector('article') as HTMLElement
}

describe('MobileEventCard', () => {
  it('renders a sans-serif title sharing the first row with the price badge', () => {
    const card = renderMobileCard(makeEvent())

    const title = within(card).getByText('Jazz Night at Niceto')
    expect(title.className).toContain('line-clamp-2')
    expect(title.className).not.toContain('font-display')

    const price = within(card).getByText(m.event_free())
    expect(price.className).toContain('rounded-lg')
    // Title (left) and price badge (right) sit in the same first row.
    expect(title.parentElement).toBe(price.parentElement)
  })

  it('keeps the location as its own row with all fallbacks intact', () => {
    expect(within(renderMobileCard(makeEvent())).getByText('Niceto Club')).toBeTruthy()

    expect(
      within(renderMobileCard(makeEvent({ venue_name: null }))).getByText(
        m.concierge_location_tba()
      )
    ).toBeTruthy()

    expect(
      within(renderMobileCard(makeEvent({ location_hidden: true }))).getByText(
        m.event_location_hidden()
      )
    ).toBeTruthy()
  })

  it('shows the paid price and TBA time fallbacks in the metadata', () => {
    expect(within(renderMobileCard(makeEvent({ is_free: false, price: 15000 }))).getByText('$15.000 ARS')).toBeTruthy()
    expect(within(renderMobileCard(makeEvent({ time_tba: true }))).getByText(m.concierge_time_tba())).toBeTruthy()
  })

  it('shares the final row between date/time and the save + details actions with no footer divider', () => {
    const card = renderMobileCard(makeEvent())

    // Three rows only: title/price, location, then meta + actions. No footer.
    expect(card.children).toHaveLength(3)
    expect(card.querySelector('[class*="border-t"]')).toBeNull()

    const finalRow = card.lastElementChild as HTMLElement
    expect(finalRow.children).toHaveLength(2)

    // Left: the wrap-friendly date/time spans with their icons.
    const meta = finalRow.firstElementChild as HTMLElement
    expect(meta.tagName).toBe('P')
    expect(meta.className).toContain('flex-wrap')
    expect(meta.querySelectorAll('svg')).toHaveLength(2)

    // Right: the distinct save + details actions.
    const actions = finalRow.lastElementChild as HTMLElement
    expect(actions.className).toContain('shrink-0')
    expect(within(actions).getByLabelText(m.event_save())).toBeTruthy()
    expect(within(actions).getByText(m.event_details_short())).toBeTruthy()
  })

  it('keeps a 44px save target and a min-height 44px details link routed to the event page', () => {
    const card = renderMobileCard(makeEvent())

    const save = within(card).getByLabelText(m.event_save())
    expect(save.className).toContain('size-11')

    const details = within(card)
      .getByText(m.event_details_short())
      .closest('a') as HTMLAnchorElement
    expect(details.className).toContain('min-h-11')
    expect(details.getAttribute('to')).toBe('/events/$id')
    expect(details.hasAttribute('state')).toBe(true)
    expect(details.querySelector('svg')).toBeTruthy()
  })

  it('does not add mobile-only analytics on render or details click', () => {
    const card = renderMobileCard(makeEvent())
    expect(track).not.toHaveBeenCalledWith('chat:event_clicked', expect.anything())

    fireEvent.click(within(card).getByText(m.event_details_short()))
    expect(track).not.toHaveBeenCalledWith('chat:event_clicked', expect.anything())
  })
})
