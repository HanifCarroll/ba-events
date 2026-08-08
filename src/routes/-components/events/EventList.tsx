import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { EventCard } from './EventCard'
import { formatShortDate, formatTime } from '@/shared/lib/utils/formatting'
import type { EventWithVenue } from '@/shared/lib/types'
import * as m from '@/paraglide/messages'

interface EventListProps {
  events: EventWithVenue[]
  /** Commentary for hero card (single recommendation mode) */
  commentary?: string
  /** Tips for hero card (single recommendation mode) */
  tips?: string[]
  onConfirmPlan?: (event: EventWithVenue) => void
  isConfirmingPlan?: boolean
}

export function EventList({
  events,
  commentary,
  tips,
  onConfirmPlan,
  isConfirmingPlan = false,
}: EventListProps) {
  return (
    <div>
      <EventCard
        event={events[0]}
        position={0}
        source="chat"
        variant="hero"
        commentary={commentary}
        tips={tips}
        onConfirmPlan={onConfirmPlan}
        isConfirmingPlan={isConfirmingPlan}
      />

      {events.length > 1 && (
        <div className="pt-6">
          <h4 className="mb-2 text-sm font-medium text-foreground">
            {m.concierge_alternatives()}
          </h4>
          <div className="divide-y divide-border border-b border-border">
            {events.slice(1).map((event) => {
              const startsAt = new Date(event.starts_at)
              return (
                <Link
                  key={event.id}
                  to="/event/$id"
                  params={{ id: event.id }}
                  className="group grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-primary">{event.name}</p>
                    <p className="truncate text-muted-foreground">
                      {event.categories.slice(0, 2).join(' · ') || event.venue_name}
                    </p>
                  </div>
                  <p className="hidden text-muted-foreground sm:block">
                    {formatShortDate(startsAt)} · {formatTime(startsAt)} · {event.venue_neighborhood || event.venue_name}
                  </p>
                  <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
