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
}

export function getSourceLabel(source: string | null | undefined): string | null {
  if (!source) return null
  return SOURCE_LABELS[source] ?? null
}

export function getExternalEventUrl(event: ExternalEventLike): string | null {
  return event.ticket_url || event.link || null
}
