import { useMemo, useState } from 'react'
import {
  createFileRoute,
  notFound,
  useCanGoBack,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'
import { ArrowLeft, Calendar, MapPin, ExternalLink, Share2, Check, Ticket } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { getEventWithVenueAction } from '@/features/events/api/crud'
import { SaveEventButton } from '@/routes/-components/SaveEventButton'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { formatEventTime, formatShortDate, formatTime } from '@/shared/lib/utils/formatting'
import { getEventUrl, resolveSiteUrl } from '@/shared/lib/utils/url'
import { getLocale } from '@/paraglide/runtime'
import {
  pickDescriptionSummary,
  pickDisplayDescription,
} from '@/features/events/lib/description-presentation'
import {
  getExternalEventUrl,
  getSourceLabel,
} from '@/features/events/lib/source-presentation'
import { getDistinctVenueAddress } from '@/features/events/lib/location-presentation'
import { BA_TIMEZONE } from '@/shared/lib/constants'
import type { EventWithVenue } from '@/shared/lib/types'
import * as m from '@/paraglide/messages'

export const Route = createFileRoute('/events/$id')({
  loader: async ({ params }) => {
    try {
      return await getEventWithVenueAction({ data: params.id })
    } catch {
      throw notFound()
    }
  },
  head: ({ loaderData }) => {
    // loaderData can be undefined during SSR or if loader hasn't completed
    if (!loaderData) {
      return {
        meta: [{ title: 'Event - BA Eventos' }],
      }
    }

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
  const locale = getLocale() as 'en' | 'es'
  const canGoBack = useCanGoBack()
  const router = useRouter()
  const fromChat = useRouterState({ select: (state) => state.location.state.fromChat === true })

  const startDate = new Date(event.starts_at)
  const dateStr = formatShortDate(startDate)
  const timeStr = event.time_tba ? m.concierge_time_tba() : formatTime(startDate)

  const externalEventUrl = getExternalEventUrl(event)

  const mapUrl = useMemo(() => {
    if (event.location_hidden) return null
    const address = event.venue_address || event.venue_name
    if (!address) return null
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${address}, Buenos Aires, Argentina`)}`
  }, [event.location_hidden, event.venue_address, event.venue_name])

  const shareUrl = getEventUrl(event.id)
  const displayDescription = pickDisplayDescription(event, locale)
  const hasDescription = Boolean(displayDescription?.trim())
  const sourceLabel = getSourceLabel(event.source)
  const sourceCtaLabel = event.ticket_url
    ? sourceLabel
      ? m.event_get_tickets_on({ source: sourceLabel })
      : m.event_get_tickets()
    : sourceLabel
      ? m.event_view_on({ source: sourceLabel })
      : m.event_open_event()
  const distinctVenueAddress = getDistinctVenueAddress(event.venue_name, event.venue_address)
  const priceDisplay = event.is_free
    ? m.event_free()
    : event.price === null
      ? null
      : `$${event.price.toLocaleString('es-AR')} ARS`
  const hasKnownPrice = event.is_free || event.price !== null

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: event.name,
          text: buildEventSummary(event, locale),
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

  const handleBackToChat = () => {
    if (canGoBack) {
      router.history.back()
      return
    }

    void router.navigate({ to: '/' })
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-24 -left-32 w-64 h-64 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-24 -right-32 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
      </div>

      <div className="relative px-5 py-5 sm:px-6 sm:py-6">
        <div className="mx-auto max-w-4xl">
          {fromChat && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleBackToChat}
              className="-ml-3 mb-5 min-h-11 text-muted-foreground hover:bg-primary/10 hover:text-primary"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {m.event_back_to_chat()}
            </Button>
          )}

          <div className={event.image_url
            ? 'grid gap-6 md:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)] md:items-start md:gap-8'
            : 'max-w-2xl'}
          >
            {event.image_url && (
              <div className="overflow-hidden rounded-2xl border border-border/30 bg-card">
                <img
                  src={resolveSiteUrl(event.image_url)}
                  alt={event.name}
                  className="aspect-square w-full object-cover"
                  loading="lazy"
                />
              </div>
            )}

            <section className="min-w-0 space-y-5" aria-labelledby="event-title">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {sourceLabel && (
                    <Badge className="bg-muted text-muted-foreground border-border/60">
                      {sourceLabel}
                    </Badge>
                  )}
                  {!hasDescription && (
                    <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">
                      {m.event_limited_info()}
                    </Badge>
                  )}
                </div>

                <h1
                  id="event-title"
                  className="text-balance text-[1.75rem] font-semibold leading-[1.08] tracking-[-0.035em] text-foreground sm:text-3xl"
                >
                  {event.name}
                </h1>
              </div>

              <dl className="space-y-3 text-sm text-muted-foreground">
                <div className="flex items-start gap-3">
                  <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" aria-hidden="true" />
                  <dd>{event.time_tba ? `${dateStr} · ${timeStr}` : formatEventTime(event.starts_at, event.ends_at)}</dd>
                </div>

                {(event.location_hidden || event.venue_name || event.venue_neighborhood) && (
                  <div className="flex items-start gap-3">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" aria-hidden="true" />
                    <dd className="min-w-0">
                      {event.location_hidden ? (
                        m.event_location_hidden()
                      ) : (
                        <>
                          <span className="block text-foreground/90">
                            {event.venue_name || event.venue_neighborhood}
                          </span>
                          {distinctVenueAddress && (
                            <span className="mt-0.5 block">{distinctVenueAddress}</span>
                          )}
                        </>
                      )}
                    </dd>
                  </div>
                )}

                {hasKnownPrice && (
                  <div className="flex items-start gap-3">
                    <Ticket className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" aria-hidden="true" />
                    <dd>{priceDisplay}</dd>
                  </div>
                )}
              </dl>

              <div className="space-y-2.5">
                <Button
                  type="button"
                  size="lg"
                  disabled={!externalEventUrl}
                  onClick={() => externalEventUrl && window.open(externalEventUrl, '_blank', 'noopener,noreferrer')}
                  className="min-h-11 w-full"
                >
                  <ExternalLink className="h-4 w-4" />
                  {sourceCtaLabel}
                </Button>

                <div className="grid grid-cols-3 gap-2">
                  <SaveEventButton
                    eventId={event.id}
                    eventName={event.name}
                    source="event_detail"
                    showLabel
                    className="border border-border/60 bg-background/50 text-muted-foreground hover:border-primary/30"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleShare}
                    aria-label={copied ? m.event_copied() : m.event_share()}
                    className="h-11 min-w-0 px-2 text-muted-foreground hover:text-primary"
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
                    <span className="truncate">{copied ? m.event_copied() : m.event_share()}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!mapUrl}
                    onClick={() => mapUrl && window.open(mapUrl, '_blank', 'noopener,noreferrer')}
                    aria-label={m.event_open_maps()}
                    className="h-11 min-w-0 px-2 text-muted-foreground hover:text-primary"
                  >
                    <MapPin className="h-4 w-4" />
                    <span className="truncate">{m.event_maps()}</span>
                  </Button>
                </div>
              </div>
            </section>
          </div>

          {(hasDescription || event.categories.length > 0) && (
            <div className="mt-6 rounded-2xl border border-border/30 bg-card p-5 sm:p-6 space-y-4">
              {hasDescription && (
                <div className="text-sm prose prose-sm prose-warm max-w-none leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-3 [&_ul]:my-3 [&_ol]:my-3 [&_strong]:text-foreground [&_strong]:font-semibold">
                  <ReactMarkdown>{displayDescription!}</ReactMarkdown>
                </div>
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
          )}
        </div>
      </div>
    </div>
  )
}

function buildEventSummary(event: EventWithVenue, locale: 'en' | 'es' = 'en'): string {
  const summary = pickDescriptionSummary(event, locale)
  const fallback = event.venue_neighborhood
    ? `Event in ${event.venue_neighborhood}`
    : 'Event in Buenos Aires'
  const base = summary && summary.length > 0 ? summary : fallback
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
    startDate: event.time_tba
      ? new Date(event.starts_at).toLocaleDateString('en-CA', { timeZone: BA_TIMEZONE })
      : event.starts_at,
    endDate: event.time_tba ? undefined : event.ends_at || undefined,
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled',
    image: imageUrl,
    url: eventUrl,
    location,
    offers,
  }
}
