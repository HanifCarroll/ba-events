import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronDown, Calendar, MapPin, Clock, ExternalLink, Ticket, RefreshCw } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
} from '@/shared/ui/collapsible'
import { EventActions } from './EventActions'
import { SaveEventButton } from '../SaveEventButton'
import { formatPrice } from '@/features/chat'
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
  onConfirmPlan?: (event: EventWithVenue) => void
  isConfirmingPlan?: boolean
}

export function EventCard({
  event,
  position,
  source = 'chat',
  variant = 'default',
  commentary,
  tips,
  onConfirmPlan,
  isConfirmingPlan = false,
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
        onConfirmPlan={onConfirmPlan}
        isConfirmingPlan={isConfirmingPlan}
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
  onConfirmPlan?: (event: EventWithVenue) => void
  isConfirmingPlan: boolean
}

function HeroEventCard({
  event,
  position,
  source,
  commentary,
  tips,
  onConfirmPlan,
  isConfirmingPlan,
}: HeroEventCardProps) {
  const locale = getLocale() as 'en' | 'es'
  const startDate = new Date(event.starts_at)
  const dateStr = formatShortDate(startDate)
  const timeStr = formatTime(startDate)
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
    <div className="mt-6 border-b border-border pb-7">
      <div className="grid gap-5 sm:grid-cols-[148px_minmax(0,1fr)] sm:gap-6">
        {event.image_url ? (
          <img
            src={event.image_url}
            alt=""
            width={296}
            height={296}
            loading="lazy"
            className="aspect-square w-full max-w-[180px] rounded-xl object-cover sm:max-w-none"
          />
        ) : (
          <div className="flex aspect-square w-full max-w-[180px] items-center justify-center rounded-xl bg-muted text-muted-foreground sm:max-w-none">
            <Calendar className="h-8 w-8" aria-hidden="true" />
          </div>
        )}

        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-xl font-semibold tracking-[-0.02em] text-foreground sm:text-2xl">
                {event.name}
              </h3>
              {(commentary || summaryDescription) && (
                <p className="mt-1.5 max-w-[58ch] text-sm leading-relaxed text-muted-foreground">
                  {commentary || summaryDescription}
                </p>
              )}
            </div>
            <SaveEventButton eventId={event.id} eventName={event.name} size="sm" source={source} />
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
            {event.enriched_at && (
              <div className="flex items-center gap-2.5 text-muted-foreground">
                <RefreshCw className="h-4 w-4 shrink-0" aria-hidden="true" />
                <dd>{m.concierge_updated_recently()}</dd>
              </div>
            )}
          </dl>

          {tips && tips.length > 0 && (
            <p className="mt-4 text-sm text-muted-foreground">{tips[0]}</p>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-2">
            {onConfirmPlan && (
              <button
                type="button"
                onClick={() => onConfirmPlan(event)}
                disabled={isConfirmingPlan}
                className="min-h-11 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isConfirmingPlan ? m.concierge_saving_plan() : m.concierge_make_it_happen()}
              </button>
            )}
            <Link
              to="/event/$id"
              params={{ id: event.id }}
              className="inline-flex min-h-11 items-center rounded-lg px-4 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
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
  const [isOpen, setIsOpen] = useState(false)
  const locale = getLocale() as 'en' | 'es'

  const startDate = new Date(event.starts_at)
  const dateStr = formatShortDate(startDate)
  const timeStr = formatTime(startDate)

  const priceDisplay = formatPrice(event.price, event.is_free)
  const isFree = event.is_free
  const summaryDescription = pickDescriptionSummary(event, locale)
  const hasDescription = Boolean(summaryDescription)
  const sourceLabel = getSourceLabel(event.source)

  const handleToggle = () => {
    const willOpen = !isOpen
    setIsOpen(willOpen)

    // Track when user expands an event card
    if (willOpen) {
      // Track for chat analytics (existing)
      track('chat:event_clicked', {
        event_id: event.id,
        event_name: event.name,
        position,
        source,
      })
      // Track for top events analytics (event:viewed)
      track('event:viewed', {
        event_id: event.id,
        event_name: event.name,
        position,
        source,
      })
    }
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="group relative overflow-hidden rounded-xl border border-border/50 bg-card transition-all duration-300 hover:border-primary/30 hover:bg-card/90">
        {/* Subtle top accent line */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        {/* Header - clickable area for expand/collapse */}
        <div className="p-4">
          <div className="flex items-start justify-between gap-4">
            {/* Main content - clickable to toggle */}
            <div
              role="button"
              tabIndex={0}
              onClick={handleToggle}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggle() }}}
              className="flex-1 min-w-0 cursor-pointer text-left focus:outline-none focus:ring-2 focus:ring-ring rounded"
              aria-expanded={isOpen}
              aria-controls={`event-details-${event.id}`}
              aria-label={isOpen ? `Collapse details for ${event.name}` : `Expand details for ${event.name}`}
            >
              <h3 className="font-display font-medium text-base text-foreground group-hover:text-primary transition-colors duration-300 line-clamp-1">
                {event.name}
              </h3>
              <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-2">
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
                <Link
                  to="/event/$id"
                  params={{ id: event.id }}
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors duration-200 ml-1"
                >
                  <span>Details</span>
                </Link>
                {event.link && (
                  <a
                    href={event.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors duration-200"
                  >
                    <span>View</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>

            {/* Actions - not part of the toggle trigger */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Price badge */}
              <span
                className={`
                  px-2.5 py-1 rounded-lg text-xs font-medium tracking-wide
                  ${isFree
                    ? 'bg-primary/15 text-primary border border-primary/20'
                    : 'bg-muted text-muted-foreground border border-border/50'
                  }
                `}
              >
                {priceDisplay}
              </span>

              {/* Save button */}
              <SaveEventButton eventId={event.id} eventName={event.name} size="sm" source={source} />

              {/* Expand indicator - clickable */}
              <button
                onClick={handleToggle}
                className={`
                  p-1 rounded-lg transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-ring
                  ${isOpen ? 'bg-primary/10 text-primary rotate-180' : 'text-muted-foreground hover:text-foreground'}
                `}
                aria-expanded={isOpen}
                aria-controls={`event-details-${event.id}`}
                aria-label={isOpen ? `Collapse details for ${event.name}` : `Expand details for ${event.name}`}
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <CollapsibleContent>
          <div id={`event-details-${event.id}`} className="px-4 pb-4">
            {/* Separator */}
            <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent mb-4" />

            {/* Expanded view */}
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
                  <span>{formatEventTime(event.starts_at, event.ends_at)}</span>
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
                          onClick={(e) => e.stopPropagation()}
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
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
