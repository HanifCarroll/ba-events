import { Link } from '@tanstack/react-router'
import {
  Target,
  Sparkles,
  Lightbulb,
  Ticket,
  ExternalLink,
  MapPin,
  Calendar,
  Clock,
  Users,
  ChevronRight,
} from 'lucide-react'
import { SaveEventButton } from '../SaveEventButton'
import { EventActions } from '../events/EventActions'
import { formatPrice } from '@/features/chat'
import { formatShortDate, formatTime } from '@/shared/lib/utils/formatting'
import { track } from '@/lib/analytics'
import { getEventUrl } from '@/shared/lib/utils/url'
import type { Recommendation, RefinementOption } from '@/shared/lib/types'

interface RecommendationCardProps {
  recommendation: Recommendation
  onRefinementSelect: (prompt: string) => void
}

export function RecommendationCard({ recommendation, onRefinementSelect }: RecommendationCardProps) {
  const { event, commentary, tips, refinements } = recommendation

  const startDate = new Date(event.starts_at)
  const dateStr = formatShortDate(startDate)
  const timeStr = formatTime(startDate)
  const priceDisplay = formatPrice(event.price, event.is_free)
  const isFree = event.is_free

  const handleRefinementClick = (refinement: RefinementOption) => {
    track('concierge:refinement_clicked', {
      refinement_id: refinement.id,
      refinement_label: refinement.label,
      event_id: event.id,
    })
    onRefinementSelect(refinement.prompt)
  }

  return (
    <div className="group relative overflow-hidden rounded-2xl border-2 border-primary/40 bg-gradient-to-br from-card via-card to-primary/5 shadow-lg shadow-primary/10 transition-all duration-500 hover:border-primary/60 hover:shadow-xl hover:shadow-primary/20">
      {/* Decorative glow orbs */}
      <div className="absolute -top-24 -right-24 w-48 h-48 bg-primary/15 rounded-full blur-3xl opacity-60 group-hover:opacity-80 transition-opacity duration-700" />
      <div className="absolute -bottom-16 -left-16 w-40 h-40 bg-primary/10 rounded-full blur-3xl opacity-40" />

      {/* Top accent bar with shimmer */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary/50 via-primary to-primary/50 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shimmer" />
      </div>

      {/* Header section */}
      <div className="relative p-5 pb-4">
        <div className="flex items-start justify-between gap-4">
          {/* Top Pick Badge */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/15 border border-primary/30 backdrop-blur-sm">
            <Target className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-primary tracking-wide">Top Pick</span>
            <Sparkles className="h-3 w-3 text-primary/70 animate-pulse" />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <SaveEventButton eventId={event.id} size="sm" source="chat" />
          </div>
        </div>

        {/* Event name */}
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

      {/* Commentary section */}
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
      {tips.length > 0 && (
        <div className="px-5 pb-4 space-y-2">
          {tips.map((tip, index) => (
            <div key={index} className="flex items-start gap-3 text-sm">
              <div className="shrink-0 p-1.5 rounded-lg bg-primary/10 mt-0.5">
                <Lightbulb className="h-3.5 w-3.5 text-primary" />
              </div>
              <span className="text-muted-foreground leading-relaxed">{tip}</span>
            </div>
          ))}
        </div>
      )}

      {/* Additional details row */}
      {(event.venue_address || event.min_age) && (
        <div className="px-5 pb-4">
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            {!event.location_hidden && event.venue_address && (
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary/60" />
                <span>{event.venue_address}</span>
              </div>
            )}
            {event.min_age && (
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-primary/60" />
                <span>{event.min_age}+ only</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Categories */}
      {event.categories.length > 0 && (
        <div className="px-5 pb-4">
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
        </div>
      )}

      {/* Price & CTA section */}
      <div className="px-5 pb-5">
        <div className="flex items-center justify-between gap-4">
          {/* Price badge */}
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
      </div>

      {/* Divider */}
      <div className="mx-5 h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />

      {/* Refinements section */}
      {refinements.length > 0 && (
        <div className="p-5 pt-4">
          <p className="text-xs text-muted-foreground/70 mb-3 uppercase tracking-wider font-medium">
            Not quite right?
          </p>
          <div className="flex flex-wrap gap-2">
            {refinements.map((refinement) => (
              <button
                key={refinement.id}
                onClick={() => handleRefinementClick(refinement)}
                className="group/ref flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground bg-muted/30 border border-border/40 hover:border-primary/40 hover:bg-primary/5 hover:text-foreground transition-all duration-200"
              >
                {refinement.label}
                <ChevronRight className="h-3.5 w-3.5 opacity-50 group-hover/ref:opacity-100 group-hover/ref:translate-x-0.5 transition-all" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Share actions */}
      <div className="px-5 pb-5 pt-2 border-t border-border/30">
        <EventActions event={event} shareUrl={getEventUrl(event.id)} />
      </div>
    </div>
  )
}
