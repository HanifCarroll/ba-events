import { Link } from '@tanstack/react-router'
import {
  Check,
  Calendar,
  Share2,
  MapPin,
  Clock,
  Navigation,
  Sparkles,
  PartyPopper,
  ExternalLink,
} from 'lucide-react'
import { EventActions } from '../events/EventActions'
import { formatShortDate, formatTime } from '@/shared/lib/utils/formatting'
import { track } from '@/lib/analytics'
import { getEventUrl } from '@/shared/lib/utils/url'
import { getLocale } from '@/paraglide/runtime'
import { pickDescriptionSummary } from '@/features/events/lib/description-presentation'
import type { EventWithVenue } from '@/shared/lib/types'

interface YourPlanCardProps {
  event: EventWithVenue
  persisted?: boolean
  requiresLogin?: boolean
  onAddToCalendar?: () => void
  onShare?: () => void
  onGetDirections?: () => void
}

/**
 * Generate a Google Calendar URL for the event
 */
function generateCalendarUrl(event: EventWithVenue, locale: 'en' | 'es'): string {
  const startDate = new Date(event.starts_at)
  const endDate = event.ends_at ? new Date(event.ends_at) : new Date(startDate.getTime() + 2 * 60 * 60 * 1000) // Default 2 hours

  // Format dates for Google Calendar (YYYYMMDDTHHmmssZ)
  const formatForCalendar = (date: Date) => {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  }

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.name,
    dates: `${formatForCalendar(startDate)}/${formatForCalendar(endDate)}`,
    details: pickDescriptionSummary(event, locale) || '',
    location: event.venue_address || event.venue_name || '',
  })

  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

/**
 * Generate a Google Maps directions URL
 */
function generateDirectionsUrl(event: EventWithVenue): string {
  const destination = event.venue_address || event.venue_name || ''
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`
}

export function YourPlanCard({
  event,
  persisted = true,
  requiresLogin = false,
  onAddToCalendar,
  onShare,
  onGetDirections,
}: YourPlanCardProps) {
  const locale = getLocale() as 'en' | 'es'
  const startDate = new Date(event.starts_at)
  const dateStr = formatShortDate(startDate)
  const timeStr = formatTime(startDate)

  const handleAddToCalendar = () => {
    track('concierge:add_to_calendar', { event_id: event.id, event_name: event.name })
    onAddToCalendar?.()
    window.open(generateCalendarUrl(event, locale), '_blank')
  }

  const handleGetDirections = () => {
    track('concierge:get_directions', { event_id: event.id, event_name: event.name })
    onGetDirections?.()
    window.open(generateDirectionsUrl(event), '_blank')
  }

  const handleShare = async () => {
    track('concierge:share_plan', { event_id: event.id, event_name: event.name })
    onShare?.()

    // Try native share API first
    if (navigator.share) {
      try {
        await navigator.share({
          title: `My plan: ${event.name}`,
          text: `I'm going to ${event.name}${event.venue_name ? ` at ${event.venue_name}` : ''} on ${dateStr}!`,
          url: getEventUrl(event.id),
        })
        return
      } catch {
        // User canceled or share failed, fall through
      }
    }

    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(getEventUrl(event.id))
    } catch {
      // Clipboard failed silently
    }
  }

  return (
    <div className="group relative overflow-hidden rounded-2xl border-2 border-primary/50 bg-gradient-to-br from-primary/15 via-card to-primary/10 shadow-xl shadow-primary/20">
      {/* Animated background glow orbs */}
      <div className="absolute -top-20 -right-20 w-56 h-56 bg-primary/25 rounded-full blur-3xl opacity-70 animate-pulse-warm" />
      <div className="absolute -bottom-20 -left-20 w-48 h-48 bg-primary/20 rounded-full blur-3xl opacity-50 animate-pulse-warm" style={{ animationDelay: '1s' }} />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-32 h-32 bg-primary/15 rounded-full blur-2xl opacity-60" />

      {/* Decorative corner sparkles */}
      <div className="absolute top-4 right-4 text-primary/40">
        <Sparkles className="h-5 w-5 animate-pulse" />
      </div>
      <div className="absolute bottom-20 left-4 text-primary/30" style={{ animationDelay: '0.5s' }}>
        <Sparkles className="h-4 w-4 animate-pulse" />
      </div>
      <div className="absolute top-1/3 right-8 text-primary/20" style={{ animationDelay: '1.5s' }}>
        <Sparkles className="h-3 w-3 animate-pulse" />
      </div>

      {/* Top accent bar with shimmer */}
      <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-primary/60 via-primary to-primary/60 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent animate-shimmer" />
      </div>

      {/* Celebratory header */}
      <div className="relative px-5 pt-6 pb-4">
        <div className="flex items-center justify-between">
          {/* Your Plan badge with checkmark */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute inset-0 bg-primary/40 rounded-full blur-md animate-pulse-warm" />
              <div className="relative flex items-center justify-center w-10 h-10 rounded-full bg-primary/20 border-2 border-primary/50">
                <Check className="h-5 w-5 text-primary" strokeWidth={3} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-primary tracking-wide">Your Plan</span>
              <PartyPopper className="h-5 w-5 text-primary/70" />
            </div>
          </div>

          {/* Confirmed badge */}
          <div className="px-3 py-1.5 rounded-full bg-primary/20 border border-primary/40">
            <span className="text-xs font-semibold text-primary uppercase tracking-wider">
              {persisted ? 'Confirmed' : 'Session only'}
            </span>
          </div>
        </div>
      </div>

      {/* Event details */}
      <div className="relative px-5 pb-4">
        {/* Event name */}
        <h3 className="font-display font-bold text-2xl md:text-3xl text-foreground leading-tight">
          {event.name}
        </h3>

        {/* Date & Time */}
        <div className="flex items-center flex-wrap gap-x-5 gap-y-2 mt-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/15">
              <Calendar className="h-4 w-4 text-primary" />
            </div>
            <span className="text-sm font-medium text-foreground">{dateStr}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/15">
              <Clock className="h-4 w-4 text-primary" />
            </div>
            <span className="text-sm font-medium text-foreground">{timeStr}</span>
          </div>
        </div>

        {/* Venue info */}
        {(event.venue_name || event.venue_address) && !event.location_hidden && (
          <div className="mt-4 p-4 rounded-xl bg-muted/30 border border-border/40">
            {event.venue_name && (
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary/70 shrink-0" />
                <span className="font-medium text-foreground">{event.venue_name}</span>
                {event.venue_neighborhood && (
                  <span className="text-sm text-muted-foreground">· {event.venue_neighborhood}</span>
                )}
              </div>
            )}
            {event.venue_address && (
              <p className="text-sm text-muted-foreground mt-1 ml-6">{event.venue_address}</p>
            )}
          </div>
        )}

        {event.location_hidden && (
          <div className="mt-4 p-4 rounded-xl bg-muted/30 border border-border/40">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-primary/70 shrink-0" />
              <span className="text-sm text-muted-foreground italic">Address provided after registration</span>
            </div>
          </div>
        )}
      </div>

      {/* Decorative divider */}
      <div className="mx-5 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />

      {/* Action buttons */}
      <div className="relative p-5 space-y-3">
        <p className="text-xs text-muted-foreground/70 uppercase tracking-wider font-medium mb-4">
          Make it happen
        </p>

        {requiresLogin && (
          <div className="rounded-xl border border-primary/25 bg-primary/10 px-4 py-3 text-sm text-foreground/85">
            This plan is only saved for this session.
            {' '}
            <Link to="/login" className="font-medium text-primary hover:text-primary/80">
              Sign in
            </Link>
            {' '}
            to keep it in Saved.
          </div>
        )}

        {/* Primary action - Add to Calendar */}
        <button
          onClick={handleAddToCalendar}
          className="group/btn w-full flex items-center justify-center gap-3 px-5 py-3.5 rounded-xl text-sm font-bold bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/35 transition-all duration-300 hover:-translate-y-0.5"
        >
          <Calendar className="h-5 w-5" />
          Add to Calendar
          <ExternalLink className="h-4 w-4 opacity-70 group-hover/btn:translate-x-0.5 transition-transform" />
        </button>

        {/* Secondary actions row */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={handleShare}
            className="group/btn flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium text-foreground bg-muted/50 border border-border/50 hover:border-primary/40 hover:bg-primary/5 transition-all duration-200"
          >
            <Share2 className="h-4 w-4 text-primary/70" />
            Share Plan
          </button>

          {!event.location_hidden && (event.venue_address || event.venue_name) && (
            <button
              onClick={handleGetDirections}
              className="group/btn flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium text-foreground bg-muted/50 border border-border/50 hover:border-primary/40 hover:bg-primary/5 transition-all duration-200"
            >
              <Navigation className="h-4 w-4 text-primary/70" />
              Directions
            </button>
          )}

          {(event.location_hidden || (!event.venue_address && !event.venue_name)) && (
            <Link
              to="/event/$id"
              params={{ id: event.id }}
              className="group/btn flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium text-foreground bg-muted/50 border border-border/50 hover:border-primary/40 hover:bg-primary/5 transition-all duration-200"
            >
              <ExternalLink className="h-4 w-4 text-primary/70" />
              Event Details
            </Link>
          )}
        </div>
      </div>

      {/* Share actions */}
      <div className="px-5 pb-5 pt-2 border-t border-border/30">
        <EventActions event={event} shareUrl={getEventUrl(event.id)} />
      </div>
    </div>
  )
}
