import { useState, useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { Calendar, MapPin, Clock, ExternalLink, Ticket, Info } from 'lucide-react'
import { EventActions } from './EventActions'
import { SaveEventButton } from '../SaveEventButton'
import { formatPrice } from '@/features/chat/lib/messages'
import { formatShortDate, formatTime, formatEventTime } from '@/shared/lib/utils/formatting'
import { track } from '@/lib/analytics'
import { getEventUrl } from '@/shared/lib/utils/url'
import { Badge } from '@/shared/ui/badge'
import { getLocale } from '@/paraglide/runtime'
import { pickDescriptionSummary } from '@/features/events/lib/description-presentation'
import { getSourceLabel } from '@/features/events/lib/source-presentation'
import type { EventWithVenue } from '@/shared/lib/types'
import * as m from '@/paraglide/messages'

interface EventCardProps {
  event: EventWithVenue
  /** Position in the list (0-indexed) for analytics */
  position?: number
  /** Source context for analytics */
  source?: 'chat' | 'saved_page'
  /** Card variant - hero is larger, always expanded, for single recommendations */
  variant?: 'default' | 'hero'
  /** Claude's personalized commentary about why this event fits (hero variant) */
  commentary?: string
  /** Practical tips like "get there around 10pm" (hero variant) */
  tips?: string[]
}

export function EventCard({
  event,
  position,
  source = 'chat',
  variant = 'default',
  commentary,
  tips,
}: EventCardProps) {
  // Hero variant renders a completely different layout
  if (variant === 'hero') {
    return (
      <HeroEventCard
        event={event}
        position={position}
        source={source}
        commentary={commentary}
        tips={tips}
      />
    )
  }

  return <DefaultEventCard event={event} position={position} source={source} />
}

// =============================================================================
// HERO VARIANT - The confident single recommendation
// =============================================================================

interface HeroEventCardProps {
  event: EventWithVenue
  position?: number
  source: 'chat' | 'saved_page'
  commentary?: string
  tips?: string[]
}

function HeroEventCard({
  event,
  position,
  source,
  commentary,
  tips,
}: HeroEventCardProps) {
  const locale = getLocale() as 'en' | 'es'
  const startDate = new Date(event.starts_at)
  const dateStr = formatShortDate(startDate)
  const timeStr = event.time_tba ? m.concierge_time_tba() : formatTime(startDate)
  const priceDisplay = formatPrice(event.price, event.is_free)
  const summaryDescription = pickDescriptionSummary(event, locale)

  // Track hero card view
  useState(() => {
    track('concierge:recommendation_shown', {
      event_id: event.id,
      event_name: event.name,
      position,
      source,
    })
  })

  return (
    <div className="mt-6 pb-7">
      <div
        className={`grid gap-5 ${
          event.image_url
            ? 'sm:grid-cols-[148px_minmax(0,1fr)] sm:gap-6'
            : 'max-w-2xl'
        }`}
      >
        {event.image_url && (
          <img
            src={event.image_url}
            alt=""
            width={640}
            height={360}
            loading="lazy"
            className="aspect-video w-full rounded-xl object-cover sm:aspect-square sm:max-w-none"
          />
        )}

        <div className="min-w-0">
          <div className={event.image_url ? undefined : 'flex items-start gap-3'}>
            {!event.image_url && (
              <div className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Calendar className="h-5 w-5" aria-hidden="true" />
              </div>
            )}
            <div className="min-w-0">
              <h3 className="text-xl font-semibold tracking-[-0.02em] text-foreground sm:text-2xl">
                {event.name}
              </h3>
              {(commentary || summaryDescription) && (
                <p className="mt-1.5 max-w-[58ch] text-sm leading-relaxed text-muted-foreground">
                  {commentary || summaryDescription}
                </p>
              )}
            </div>
          </div>

          <dl className="mt-5 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div className="flex items-center gap-2.5">
              <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <dd>{dateStr}</dd>
            </div>
            <div className="flex items-center gap-2.5">
              <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <dd>{event.venue_neighborhood || event.venue_name || m.concierge_location_tba()}</dd>
            </div>
            <div className="flex items-center gap-2.5">
              <Clock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <dd>{timeStr}</dd>
            </div>
            <div className="flex items-center gap-2.5">
              <Ticket className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <dd>{priceDisplay}</dd>
            </div>
            {event.venue_name && (
              <div className="flex items-center gap-2.5">
                <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <dd>{event.venue_name}</dd>
              </div>
            )}
          </dl>

          {tips && tips.length > 0 && (
            <p className="mt-4 text-sm text-muted-foreground">{tips[0]}</p>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <SaveEventButton eventId={event.id} eventName={event.name} size="md" source={source} />
            <Link
              to="/events/$id"
              params={{ id: event.id }}
              state={{ fromChat: source === 'chat' }}
              className="inline-flex min-h-11 items-center rounded-lg px-4 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Info className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {m.concierge_event_details()}
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// DEFAULT VARIANT - The original collapsible card
// =============================================================================

interface DefaultEventCardProps {
  event: EventWithVenue
  position?: number
  source: 'chat' | 'saved_page'
}

function DefaultEventCard({ event, position, source }: DefaultEventCardProps) {
  return (
    <>
      <div className="sm:hidden">
        <MobileEventCard event={event} source={source} />
      </div>
      <div className="hidden sm:block">
        <DesktopEventCard event={event} position={position} source={source} />
      </div>
    </>
  )
}

function MobileEventCard({ event, source }: Pick<DefaultEventCardProps, 'event' | 'source'>) {
  const startDate = new Date(event.starts_at)
  const dateStr = formatShortDate(startDate)
  const timeStr = event.time_tba ? m.concierge_time_tba() : formatTime(startDate)
  const priceDisplay = formatPrice(event.price, event.is_free)
  const isFree = event.is_free || event.price === 0

  return (
    <article className="rounded-xl bg-card/60 px-3 py-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <h3 className="line-clamp-2 font-display text-base font-medium leading-snug text-foreground">
          {event.name}
        </h3>
        <span
          className={`rounded-lg border px-2.5 py-1 text-xs font-medium tracking-wide ${
            isFree
              ? 'border-primary/20 bg-primary/15 text-primary'
              : 'border-border/50 bg-muted text-muted-foreground'
          }`}
        >
          {priceDisplay}
        </span>
      </div>

      <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
        <p className="flex min-w-0 items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 shrink-0 text-primary/60" aria-hidden="true" />
          <span className="truncate">
            {event.location_hidden
              ? m.event_location_hidden()
              : event.venue_name || m.concierge_location_tba()}
          </span>
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 text-primary/60" aria-hidden="true" />
            {dateStr}
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-primary/60" aria-hidden="true" />
            {timeStr}
          </span>
        </p>
      </div>

      <div className="mt-2 flex items-center gap-1 border-t border-border/40 pt-1">
        <SaveEventButton
          eventId={event.id}
          eventName={event.name}
          size="sm"
          source={source}
          className="size-11"
        />
        <Link
          to="/events/$id"
          params={{ id: event.id }}
          state={{ fromChat: source === 'chat' }}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-primary transition-colors hover:bg-primary/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Info className="h-4 w-4" aria-hidden="true" />
          <span>{m.event_details_short()}</span>
        </Link>
      </div>
    </article>
  )
}

function DesktopEventCard({ event, position, source }: DefaultEventCardProps) {
  const locale = getLocale() as 'en' | 'es'

  const startDate = new Date(event.starts_at)
  const dateStr = formatShortDate(startDate)
  const timeStr = event.time_tba ? m.concierge_time_tba() : formatTime(startDate)

  const priceDisplay = formatPrice(event.price, event.is_free)
  const isFree = event.is_free || event.price === 0
  const summaryDescription = pickDescriptionSummary(event, locale)
  const hasDescription = Boolean(summaryDescription)
  const sourceLabel = getSourceLabel(event.source)

  // Card content is always visible — track the view on mount.
  useEffect(() => {
    track('event:viewed', {
      event_id: event.id,
      event_name: event.name,
      position,
      source,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id])

  return (
    <div className="group relative overflow-hidden rounded-xl bg-card/60 transition-colors duration-300 hover:bg-card/90">
        <div className="p-4">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4">
            <h3 className="line-clamp-1 font-display text-base font-medium text-foreground">
              {event.name}
            </h3>

            <div className="flex shrink-0 items-center gap-2">
              <span
                className={`rounded-lg border px-2.5 py-1 text-xs font-medium tracking-wide ${
                  isFree
                    ? 'border-primary/20 bg-primary/15 text-primary'
                    : 'border-border/50 bg-muted text-muted-foreground'
                }`}
              >
                {priceDisplay}
              </span>
            </div>

            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              {event.location_hidden ? (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3 text-primary/60" />
                  <span className="truncate max-w-[140px] italic">Address after registration</span>
                </span>
              ) : event.venue_name && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin className="h-3 w-3 text-primary/60" />
                  <span className="truncate max-w-[120px]">{event.venue_name}</span>
                </span>
              )}
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Calendar className="h-3 w-3 text-primary/60" />
                {dateStr}
              </span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3 w-3 text-primary/60" />
                {timeStr}
              </span>
            </div>

          </div>
        </div>

        <div id={`event-details-${event.id}`} className="px-4 pb-4">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                {sourceLabel && (
                  <Badge className="bg-muted text-muted-foreground border-border/60">
                    {sourceLabel}
                  </Badge>
                )}
                {!hasDescription && (
                  <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">
                    Limited info
                  </Badge>
                )}
              </div>

              {/* Description */}
              {summaryDescription && (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {summaryDescription}
                </p>
              )}

              {/* Details grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4 text-primary/60" />
                  <span>
                    {event.time_tba
                      ? `${dateStr} · ${m.concierge_time_tba()}`
                      : formatEventTime(event.starts_at, event.ends_at)}
                  </span>
                </div>
                {event.location_hidden ? (
                  <div className="flex items-start gap-2 text-sm text-muted-foreground col-span-2">
                    <MapPin className="h-4 w-4 text-primary/60 shrink-0 mt-0.5" />
                    <span className="italic">
                      Address shared after registration.{' '}
                      {event.link && (
                        <a
                          href={event.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline font-medium"
                        >
                          Register to see
                        </a>
                      )}
                    </span>
                  </div>
                ) : (
                  <>
                    {event.venue_neighborhood && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <MapPin className="h-4 w-4 text-primary/60" />
                        <span>{event.venue_neighborhood}</span>
                      </div>
                    )}
                    {event.venue_address && (
                      <div className="flex items-start gap-2 text-sm text-muted-foreground col-span-2">
                        <MapPin className="h-4 w-4 text-primary/60 shrink-0 mt-0.5" />
                        <span>{event.venue_address}</span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Categories */}
              {event.categories.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {event.categories.slice(0, 3).map((cat) => (
                    <span
                      key={cat}
                      className="px-2.5 py-1 rounded-lg text-xs bg-primary/10 text-primary/90 border border-primary/20"
                    >
                      {cat}
                    </span>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-between pt-2">
                <EventActions event={event} shareUrl={getEventUrl(event.id)} />
              </div>

            </div>
        </div>

        {/* Footer actions - save and event details grouped together */}
        <div className="flex items-center gap-2 border-t border-border/40 px-4 py-3">
          <SaveEventButton eventId={event.id} eventName={event.name} size="sm" source={source} />
          <Link
            to="/events/$id"
            params={{ id: event.id }}
            state={{ fromChat: source === 'chat' }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-primary transition-colors duration-200"
          >
            <Info className="h-3.5 w-3.5" />
            <span>{m.event_details_short()}</span>
          </Link>
          {event.link && (
            <a
              href={event.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-primary transition-colors duration-200"
            >
              <span>{m.event_view()}</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
  )
}
