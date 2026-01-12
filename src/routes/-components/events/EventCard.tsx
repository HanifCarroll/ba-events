import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronDown, Calendar, MapPin, Clock, ExternalLink, Target, Lightbulb, Ticket, Sparkles } from 'lucide-react'
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
import type { EventWithVenue } from '@/shared/lib/types'

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

export function EventCard({ event, position, source = 'chat', variant = 'default', commentary, tips }: EventCardProps) {
  // Hero variant renders a completely different layout
  if (variant === 'hero') {
    return <HeroEventCard event={event} position={position} source={source} commentary={commentary} tips={tips} />
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

function HeroEventCard({ event, position, source, commentary, tips }: HeroEventCardProps) {
  const startDate = new Date(event.starts_at)
  const dateStr = formatShortDate(startDate)
  const timeStr = formatTime(startDate)
  const priceDisplay = formatPrice(event.price, event.is_free)
  const isFree = event.is_free
  const hasDescription = Boolean(event.description_en || event.description_es)

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
    <div className="group relative overflow-hidden rounded-2xl border-2 border-primary/40 bg-gradient-to-br from-card via-card to-primary/5 shadow-lg shadow-primary/10 transition-all duration-500 hover:border-primary/60 hover:shadow-xl hover:shadow-primary/20">
      {/* Decorative glow effect */}
      <div className="absolute -top-20 -right-20 w-40 h-40 bg-primary/20 rounded-full blur-3xl opacity-50 group-hover:opacity-70 transition-opacity duration-500" />
      <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-primary/10 rounded-full blur-2xl opacity-30" />

      {/* Top accent bar with shimmer */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary/60 via-primary to-primary/60">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
      </div>

      {/* Header section */}
      <div className="relative p-5 pb-4">
        <div className="flex items-start justify-between gap-4">
          {/* Top Pick Badge */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/15 border border-primary/30 backdrop-blur-sm">
            <Target className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-primary tracking-wide">Top Pick</span>
            <Sparkles className="h-3 w-3 text-primary/70" />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <SaveEventButton eventId={event.id} size="sm" source={source} />
          </div>
        </div>

        {/* Event name - larger, more prominent */}
        <h3 className="font-display font-semibold text-2xl text-foreground mt-4 leading-tight group-hover:text-primary transition-colors duration-300">
          {event.name}
        </h3>

        {/* Venue & time info */}
        <div className="flex items-center flex-wrap gap-x-4 gap-y-2 mt-3">
          {event.location_hidden ? (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4 text-primary/70" />
              <span className="italic">Address after registration</span>
            </span>
          ) : (
            <>
              {event.venue_name && (
                <span className="flex items-center gap-2 text-sm text-foreground/80 font-medium">
                  <MapPin className="h-4 w-4 text-primary/70" />
                  {event.venue_name}
                </span>
              )}
              {event.venue_neighborhood && (
                <span className="text-sm text-muted-foreground">
                  {event.venue_neighborhood}
                </span>
              )}
            </>
          )}
          <span className="flex items-center gap-2 text-sm text-foreground/80">
            <Calendar className="h-4 w-4 text-primary/70" />
            {dateStr}
          </span>
          <span className="flex items-center gap-2 text-sm text-foreground/80">
            <Clock className="h-4 w-4 text-primary/70" />
            {timeStr}
          </span>
        </div>
      </div>

      {/* Commentary section - the "why" from Claude */}
      {commentary && (
        <div className="relative px-5 pb-4">
          <div className="relative pl-4 py-3 border-l-2 border-primary/50 bg-primary/5 rounded-r-lg">
            <p className="text-sm text-foreground/90 italic leading-relaxed">
              "{commentary}"
            </p>
          </div>
        </div>
      )}

      {/* Tips section */}
      {tips && tips.length > 0 && (
        <div className="px-5 pb-4 space-y-2">
          {tips.map((tip, index) => (
            <div key={index} className="flex items-start gap-3 text-sm">
              <div className="shrink-0 p-1 rounded-md bg-primary/10 mt-0.5">
                <Lightbulb className="h-3.5 w-3.5 text-primary" />
              </div>
              <span className="text-muted-foreground leading-relaxed">{tip}</span>
            </div>
          ))}
        </div>
      )}

      {/* Divider */}
      <div className="mx-5 h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />

      {/* Expanded details - always shown for hero */}
      <div className="p-5 pt-4 space-y-4">
        {/* Description */}
        {event.description_en && (
          <p className="text-sm text-muted-foreground leading-relaxed">
            {event.description_en}
          </p>
        )}
        {!event.description_en && event.description_es && (
          <p className="text-sm text-muted-foreground leading-relaxed">
            {event.description_es}
          </p>
        )}
        {!hasDescription && (
          <p className="text-sm text-muted-foreground/60 italic">
            Check the event link for more details.
          </p>
        )}

        {/* Details row */}
        <div className="flex flex-wrap items-center gap-3">
          {!event.location_hidden && event.venue_address && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4 text-primary/60" />
              <span>{event.venue_address}</span>
            </div>
          )}
        </div>

        {/* Categories */}
        {event.categories.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {event.categories.slice(0, 4).map((cat) => (
              <span
                key={cat}
                className="px-2.5 py-1 rounded-lg text-xs bg-primary/10 text-primary/90 border border-primary/20 font-medium"
              >
                {cat}
              </span>
            ))}
          </div>
        )}

        {/* Price & CTA section */}
        <div className="flex items-center justify-between gap-4 pt-2">
          <div className="flex items-center gap-3">
            {/* Price badge - more prominent */}
            <span
              className={`
                px-4 py-2 rounded-xl text-sm font-bold tracking-wide
                ${isFree
                  ? 'bg-primary/20 text-primary border-2 border-primary/30'
                  : 'bg-muted text-foreground border border-border/50'
                }
              `}
            >
              {priceDisplay}
            </span>
          </div>

          {/* CTA buttons */}
          <div className="flex items-center gap-2">
            <Link
              to="/event/$id"
              params={{ id: event.id }}
              className="px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:text-foreground border border-border/50 hover:border-border transition-all duration-200"
            >
              More Info
            </Link>
            {event.ticket_url ? (
              <a
                href={event.ticket_url}
                target="_blank"
                rel="noopener noreferrer"
                className="group/btn flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold bg-primary text-primary-foreground hover:bg-primary/90 shadow-md shadow-primary/25 hover:shadow-lg hover:shadow-primary/30 transition-all duration-300 hover:-translate-y-0.5"
                onClick={() => track('concierge:ticket_clicked', { event_id: event.id, event_name: event.name })}
              >
                <Ticket className="h-4 w-4" />
                Get Tickets
                <ExternalLink className="h-3 w-3 opacity-70 group-hover/btn:translate-x-0.5 transition-transform" />
              </a>
            ) : event.link ? (
              <a
                href={event.link}
                target="_blank"
                rel="noopener noreferrer"
                className="group/btn flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold bg-primary text-primary-foreground hover:bg-primary/90 shadow-md shadow-primary/25 hover:shadow-lg hover:shadow-primary/30 transition-all duration-300 hover:-translate-y-0.5"
              >
                View Event
                <ExternalLink className="h-3 w-3 opacity-70 group-hover/btn:translate-x-0.5 transition-transform" />
              </a>
            ) : null}
          </div>
        </div>

        {/* Share actions */}
        <div className="flex items-center justify-between pt-2 border-t border-border/30">
          <EventActions event={event} shareUrl={getEventUrl(event.id)} />
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

  const startDate = new Date(event.starts_at)
  const dateStr = formatShortDate(startDate)
  const timeStr = formatTime(startDate)

  const priceDisplay = formatPrice(event.price, event.is_free)
  const isFree = event.is_free
  const hasDescription = Boolean(event.description_en || event.description_es)
  const sourceLabel = getSourceLabel(event.source)

  const handleToggle = () => {
    const willOpen = !isOpen
    setIsOpen(willOpen)

    // Track when user expands an event card
    if (willOpen) {
      track('chat:event_clicked', {
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
              <SaveEventButton eventId={event.id} size="sm" source={source} />

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
              {event.description_en && (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {event.description_en}
                </p>
              )}
              {!event.description_en && event.description_es && (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {event.description_es}
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

function getSourceLabel(source: string | null | undefined): string | null {
  if (!source) return null
  switch (source) {
    case 'passline':
      return 'Passline'
    case 'eventbrite':
      return 'Eventbrite'
    case 'ba-tourism':
      return 'BA Tourism'
    case 'meetup':
      return 'Meetup'
    default:
      return null
  }
}
