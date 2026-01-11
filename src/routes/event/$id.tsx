import { useMemo, useState } from 'react'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { Calendar, Clock, MapPin, Ticket, Share2, Check, ArrowLeft } from 'lucide-react'
import { getEventWithVenueAction } from '@/features/events'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { formatEventTime, formatShortDate, formatTime } from '@/shared/lib/utils/formatting'
import { getEventUrl, resolveSiteUrl } from '@/shared/lib/utils/url'
import type { EventWithVenue } from '@/shared/lib/types'

export const Route = createFileRoute('/event/$id')({
  loader: async ({ params }) => {
    try {
      return await getEventWithVenueAction({ data: params.id })
    } catch {
      throw notFound()
    }
  },
  head: ({ loaderData }) => {
    const eventUrl = getEventUrl(loaderData.id)
    const summary = buildEventSummary(loaderData)
    const imageUrl = loaderData.image_url
      ? resolveSiteUrl(loaderData.image_url)
      : resolveSiteUrl('/og-image.png')
    const eventJsonLd = buildEventJsonLd(loaderData, eventUrl, imageUrl)

    return {
      meta: [
        { title: `${loaderData.name} - BA Eventos` },
        { name: 'description', content: summary },
        { property: 'og:type', content: 'event' },
        { property: 'og:title', content: loaderData.name },
        { property: 'og:description', content: summary },
        { property: 'og:image', content: imageUrl },
        { property: 'og:url', content: eventUrl },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: loaderData.name },
        { name: 'twitter:description', content: summary },
        { name: 'twitter:image', content: imageUrl },
      ],
      links: [
        { rel: 'canonical', href: eventUrl },
      ],
      scripts: [
        {
          type: 'application/ld+json',
          children: JSON.stringify(eventJsonLd),
        },
      ],
    }
  },
  component: EventDetailPage,
})

function EventDetailPage() {
  const event = Route.useLoaderData()
  const [copied, setCopied] = useState(false)

  const startDate = new Date(event.starts_at)
  const dateStr = formatShortDate(startDate)
  const timeStr = formatTime(startDate)

  const ticketsUrl = event.ticket_url || event.link || null

  const mapUrl = useMemo(() => {
    if (event.location_hidden) return null
    const address = event.venue_address || event.venue_name
    if (!address) return null
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${address}, Buenos Aires, Argentina`)}`
  }, [event.location_hidden, event.venue_address, event.venue_name])

  const shareUrl = getEventUrl(event.id)

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: event.name,
          text: buildEventSummary(event),
          url: shareUrl,
        })
        return
      } catch {
        // fall back to clipboard
      }
    }

    await navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-24 -left-32 w-64 h-64 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-24 -right-32 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
      </div>

      <div className="relative px-6 py-6 border-b border-border/30">
        <div className="max-w-4xl mx-auto">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to events
          </Link>

          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <h1 className="font-display text-2xl md:text-3xl font-semibold tracking-tight text-foreground">
                {event.name}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-primary/70" />
                  {dateStr}
                </span>
                <span className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary/70" />
                  {timeStr}
                </span>
                {!event.location_hidden && (event.venue_neighborhood || event.venue_name) && (
                  <span className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-primary/70" />
                    {event.venue_neighborhood || event.venue_name}
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleShare}
              >
                {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
                {copied ? 'Copied' : 'Share'}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!mapUrl}
                onClick={() => mapUrl && window.open(mapUrl, '_blank', 'noopener,noreferrer')}
              >
                <MapPin className="h-4 w-4" />
                Open in Maps
              </Button>
              <Button
                type="button"
                disabled={!ticketsUrl}
                onClick={() => ticketsUrl && window.open(ticketsUrl, '_blank', 'noopener,noreferrer')}
              >
                <Ticket className="h-4 w-4" />
                Get Tickets
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="relative flex-1 overflow-auto px-6 py-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {event.image_url && (
            <div className="overflow-hidden rounded-2xl border border-border/30 bg-card">
              <img
                src={resolveSiteUrl(event.image_url)}
                alt={event.name}
                className="h-64 w-full object-cover"
                loading="lazy"
              />
            </div>
          )}

          <div className="rounded-2xl border border-border/30 bg-card p-6 space-y-4">
            <div className="grid gap-3 md:grid-cols-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-primary/70" />
                <span>{formatEventTime(event.starts_at, event.ends_at)}</span>
              </div>
              {event.venue_name && (
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-primary/70" />
                  <span>{event.venue_name}</span>
                </div>
              )}
              {!event.location_hidden && event.venue_address && (
                <div className="flex items-start gap-2 md:col-span-2">
                  <MapPin className="h-4 w-4 text-primary/70 mt-0.5" />
                  <span>{event.venue_address}</span>
                </div>
              )}
            </div>

            {event.location_hidden && (
              <div className="rounded-lg border border-border/40 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                Location is hidden until registration. Use the event link to reveal the address.
              </div>
            )}

            {(event.description_en || event.description_es) && (
              <p className="text-sm text-muted-foreground leading-relaxed">
                {event.description_en || event.description_es}
              </p>
            )}

            {event.categories.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {event.categories.map((cat) => (
                  <Badge key={cat} className="bg-primary/10 text-primary/90 border-primary/20">
                    {cat}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function buildEventSummary(event: EventWithVenue): string {
  const raw = event.description_en || event.description_es || ''
  const cleaned = raw.replace(/\s+/g, ' ').trim()
  const fallback = event.venue_neighborhood
    ? `Event in ${event.venue_neighborhood}`
    : 'Event in Buenos Aires'
  const base = cleaned.length > 0 ? cleaned : fallback
  const maxLength = 160

  if (base.length <= maxLength) return base
  return `${base.slice(0, maxLength - 3).trim()}...`
}

function buildEventJsonLd(event: EventWithVenue, eventUrl: string, imageUrl: string) {
  const description = buildEventSummary(event)
  const isFree = event.is_free || event.price === 0
  const venueName = event.venue_name || 'Venue'

  const location = event.location_hidden
    ? {
        '@type': 'Place',
        name: venueName,
        address: {
          '@type': 'PostalAddress',
          addressLocality: 'Buenos Aires',
          addressCountry: 'AR',
        },
      }
    : {
        '@type': 'Place',
        name: venueName,
        address: {
          '@type': 'PostalAddress',
          addressLocality: 'Buenos Aires',
          addressCountry: 'AR',
          streetAddress: event.venue_address || undefined,
        },
      }

  const offers = {
    '@type': 'Offer',
    price: isFree ? '0' : String(event.price ?? ''),
    priceCurrency: 'ARS',
    url: event.ticket_url || event.link || eventUrl,
    availability: 'https://schema.org/InStock',
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.name,
    description,
    startDate: event.starts_at,
    endDate: event.ends_at || undefined,
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled',
    image: imageUrl,
    url: eventUrl,
    location,
    offers,
  }
}
