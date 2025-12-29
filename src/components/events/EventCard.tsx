import { useState } from 'react'
import { ChevronDown, Calendar, MapPin, Clock, Users, ExternalLink } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
} from '@/components/ui/collapsible'
import { EventActions } from './EventActions'
import { SaveEventButton } from '@/components/SaveEventButton'
import { formatPrice, formatEventTime } from '@/lib/chat'
import type { EventWithVenue } from '@/lib/types'

interface EventCardProps {
  event: EventWithVenue
}

export function EventCard({ event }: EventCardProps) {
  const [isOpen, setIsOpen] = useState(false)

  const startDate = new Date(event.starts_at)
  const dateStr = startDate.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  const timeStr = startDate.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })

  const priceDisplay = formatPrice(event.price, event.is_free)
  const isFree = event.is_free

  const handleToggle = () => setIsOpen(!isOpen)

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
              className="flex-1 min-w-0 cursor-pointer text-left focus:outline-none focus:ring-2 focus:ring-primary/20 rounded"
            >
              <h3 className="font-display font-medium text-base text-foreground group-hover:text-primary transition-colors duration-300 line-clamp-1">
                {event.name}
              </h3>
              <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-2">
                {event.venue_name && (
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
                {event.link && (
                  <a
                    href={event.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors duration-200 ml-1"
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
              <SaveEventButton eventId={event.id} size="sm" />

              {/* Expand indicator - clickable */}
              <button
                onClick={handleToggle}
                className={`
                  p-1 rounded-lg transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-primary/20
                  ${isOpen ? 'bg-primary/10 text-primary rotate-180' : 'text-muted-foreground hover:text-foreground'}
                `}
                aria-expanded={isOpen}
                aria-label={isOpen ? 'Collapse details' : 'Expand details'}
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <CollapsibleContent>
          <div className="px-4 pb-4">
            {/* Separator */}
            <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent mb-4" />

            {/* Expanded view */}
            <div className="space-y-4">
              {/* Description */}
              {event.description_en && (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {event.description_en}
                </p>
              )}

              {/* Details grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4 text-primary/60" />
                  <span>{formatEventTime(event.starts_at, event.ends_at)}</span>
                </div>
                {event.venue_neighborhood && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="h-4 w-4 text-primary/60" />
                    <span>{event.venue_neighborhood}</span>
                  </div>
                )}
                {event.min_age && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Users className="h-4 w-4 text-primary/60" />
                    <span>{event.min_age}+ only</span>
                  </div>
                )}
              </div>

              {/* Categories & vibes */}
              {(event.categories.length > 0 || event.vibes.length > 0) && (
                <div className="flex flex-wrap gap-2">
                  {event.categories.slice(0, 3).map((cat) => (
                    <span
                      key={cat}
                      className="px-2.5 py-1 rounded-lg text-xs bg-primary/10 text-primary/90 border border-primary/20"
                    >
                      {cat}
                    </span>
                  ))}
                  {event.vibes.slice(0, 2).map((vibe) => (
                    <span
                      key={vibe}
                      className="px-2.5 py-1 rounded-lg text-xs bg-muted text-muted-foreground border border-border/50"
                    >
                      {vibe}
                    </span>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-between pt-2">
                <EventActions event={event} />
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
