import * as m from '#paraglide/messages.js'

interface ExternalEventLike {
  ticket_url: string | null
  link: string | null
}

const SOURCE_LABELS: Record<string, string> = {
  passline: 'Passline',
  eventbrite: 'Eventbrite',
  'ba-tourism': 'BA Tourism',
  meetup: 'Meetup',
  luma: 'Luma',
  venti: 'Venti',
  instagram: 'Instagram',
}

/**
 * What the external URL of an event actually does, derived from the import
 * source. Importers store the event/source page in `ticket_url` for Meetup,
 * Luma and BA Tourism, so the URL alone cannot tell tickets from RSVPs.
 */
export type ExternalActionKind = 'tickets' | 'rsvp' | 'register' | 'source'

const SOURCE_ACTION_KINDS: Record<string, ExternalActionKind> = {
  passline: 'tickets',
  eventbrite: 'tickets',
  venti: 'tickets',
  meetup: 'rsvp',
  luma: 'register',
}

export function getSourceLabel(source: string | null | undefined): string | null {
  if (!source) return null
  return SOURCE_LABELS[source] ?? null
}

export function getExternalEventUrl(event: ExternalEventLike): string | null {
  return event.ticket_url || event.link || null
}

export function getExternalActionKind(source: string | null | undefined): ExternalActionKind {
  if (!source) return 'source'
  return SOURCE_ACTION_KINDS[source] ?? 'source'
}

/**
 * Analytics `link_type` value for an external action. Stays `ticket` (singular)
 * for tickets to match existing events; other kinds use their action name.
 */
export function getExternalLinkType(kind: ExternalActionKind): string {
  return kind === 'tickets' ? 'ticket' : kind
}

/**
 * Localized CTA label for an external action. Includes the source name when
 * known ("Register on Luma") so the button describes exactly what it does.
 */
export function getExternalActionLabel(
  kind: ExternalActionKind,
  sourceLabel: string | null
): string {
  switch (kind) {
    case 'tickets':
      return sourceLabel
        ? m.event_get_tickets_on({ source: sourceLabel })
        : m.event_get_tickets()
    case 'rsvp':
      return sourceLabel ? m.event_rsvp_on({ source: sourceLabel }) : m.event_rsvp()
    case 'register':
      return sourceLabel
        ? m.event_register_on({ source: sourceLabel })
        : m.event_register()
    case 'source':
      return sourceLabel ? m.event_view_on({ source: sourceLabel }) : m.event_open_event()
  }
}
