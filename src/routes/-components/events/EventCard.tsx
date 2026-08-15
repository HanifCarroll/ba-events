import { useState, useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { Calendar, MapPin, Clock, ExternalLink, Ticket, Info, Share2, Check } from 'lucide-react'
import { SaveEventButton } from '../SaveEventButton'
import { Button } from '@/shared/ui/button'
import { formatPrice } from '@/features/chat/lib/messages'
import { formatShortDate, formatTime } from '@/shared/lib/utils/formatting'
import { track } from '@/lib/analytics'
import { getEventUrl } from '@/shared/lib/utils/url'
import { getLocale } from '@/paraglide/runtime'
import { pickDescriptionSummary } from '@/features/events/lib/description-presentation'
import {
  getExternalActionKind,
  getExternalActionLabel,
  getExternalEventUrl,
  getExternalLinkType,
  getSourceLabel,
} from '@/features/events/lib/source-presentation'
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
        <h3 className="line-clamp-2 text-base font-medium leading-snug text-foreground">
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
      </div>

      <div className="mt-2 flex items-center gap-2">
        <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 text-primary/60" aria-hidden="true" />
            {dateStr}
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-primary/60" aria-hidden="true" />
            {timeStr}
          </span>
        </p>
        <div className="flex shrink-0 items-center gap-1">
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
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Info className="h-4 w-4" aria-hidden="true" />
            <span>{m.event_details_short()}</span>
          </Link>
        </div>
      </div>
    </article>
  )
}

function DesktopEventCard({ event, position, source }: DefaultEventCardProps) {
  const locale = getLocale() as 'en' | 'es'
  const [copied, setCopied] = useState(false)

  const startDate = new Date(event.starts_at)
  const dateStr = formatShortDate(startDate)
  const timeStr = event.time_tba ? m.concierge_time_tba() : formatTime(startDate)

  const priceDisplay = formatPrice(event.price, event.is_free)
  const summaryDescription = pickDescriptionSummary(event, locale)
  const hasDescription = Boolean(summaryDescription)
  const sourceLabel = getSourceLabel(event.source)
  const placeLabel = event.location_hidden
    ? m.event_location_hidden()
    : event.venue_name || event.venue_neighborhood || m.concierge_location_tba()

  const externalUrl = getExternalEventUrl(event)
  const externalActionKind = getExternalActionKind(event.source)
  const externalActionLabel = getExternalActionLabel(externalActionKind, sourceLabel)
  const contextSegments = [
    ...(sourceLabel ? [sourceLabel] : []),
    ...event.categories.slice(0, 2),
    ...(!hasDescription ? [m.event_limited_info()] : []),
  ]

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

  const handleShare = async () => {
    const shareUrl = getEventUrl(event.id)
    const shareText = event.venue_name
      ? m.event_share_text_venue({ name: event.name, venue: event.venue_name })
      : m.event_share_text_no_venue({ name: event.name })

    if (navigator.share) {
      try {
        await navigator.share({ title: event.name, text: shareText, url: shareUrl })
        track('event:shared', { event_id: event.id, event_name: event.name, share_method: 'native' })
        return
      } catch {
        // User canceled or share failed — fall back to clipboard
      }
    }

    await navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    track('event:shared', { event_id: event.id, event_name: event.name, share_method: 'clipboard' })
    setTimeout(() => setCopied(false), 2000)
  }

  const handleExternalClick = () => {
    track('event:link_clicked', {
      event_id: event.id,
      event_name: event.name,
      link_type: getExternalLinkType(externalActionKind),
    })
  }

  const handleDetailsClick = () => {
    track('chat:event_clicked', {
      event_id: event.id,
      event_name: event.name,
      position,
      source,
    })
  }

  return (
    <article className="border-b border-border/40 py-4 last:border-b-0">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="min-w-0 truncate text-[15px] font-medium tracking-[-0.01em] text-foreground">
          {event.name}
        </h3>
        <span className="shrink-0 text-sm font-medium text-foreground/85">{priceDisplay}</span>
      </div>

      <p className="mt-1 flex flex-nowrap items-center gap-x-1.5 text-[13px] text-muted-foreground">
        <span className="shrink-0">{dateStr}</span>
        <span aria-hidden="true" className="text-muted-foreground/50">·</span>
        <span className="shrink-0">{timeStr}</span>
        <span aria-hidden="true" className="text-muted-foreground/50">·</span>
        <span className="min-w-0 truncate">{placeLabel}</span>
      </p>

      {summaryDescription && (
        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {summaryDescription}
        </p>
      )}

      {contextSegments.length > 0 && (
        <p className="mt-1.5 text-xs text-muted-foreground/75">
          {contextSegments.map((segment, index) => (
            <span key={`${index}-${segment}`}>
              {index > 0 && (
                <span aria-hidden="true" className="mx-1.5 text-muted-foreground/40">·</span>
              )}
              {segment}
            </span>
          ))}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <SaveEventButton
          eventId={event.id}
          eventName={event.name}
          size="sm"
          showLabel
          source={source}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleShare}
          aria-label={copied ? m.event_copied() : m.event_share()}
          className="text-muted-foreground hover:text-primary hover:bg-primary/10"
        >
          {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
          <span>{copied ? m.event_copied() : m.event_share()}</span>
        </Button>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-primary hover:bg-primary/10"
        >
          <Link
            to="/events/$id"
            params={{ id: event.id }}
            state={{ fromChat: source === 'chat' }}
            onClick={handleDetailsClick}
          >
            <Info className="h-4 w-4" aria-hidden="true" />
            <span>{m.event_details_short()}</span>
          </Link>
        </Button>
        {/* Comparison-list external actions are quiet outlines, not filled
            primaries: transparent at rest, restrained indigo border/text,
            pale indigo hover, and the shared Button focus ring. */}
        {externalUrl && (
          <Button
            asChild
            variant="outline"
            size="sm"
            className="ml-auto border-primary/40 bg-transparent text-primary shadow-none hover:bg-primary/10 hover:text-primary"
          >
            <a
              href={externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleExternalClick}
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              <span>{externalActionLabel}</span>
            </a>
          </Button>
        )}
      </div>
    </article>
  )
}
