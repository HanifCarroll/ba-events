import { EventCard } from './EventCard'
import type { EventWithVenue } from '@/shared/lib/types'

interface EventListProps {
  events: EventWithVenue[]
  /** Commentary for hero card (single recommendation mode) */
  commentary?: string
  /** Tips for hero card (single recommendation mode) */
  tips?: string[]
}

export function EventList({
  events,
  commentary,
  tips,
}: EventListProps) {
  // Single recommendation → confident hero card.
  // Multiple events → plain equal list (no "main" pick, no "you might also like").
  if (events.length === 1) {
    return (
      <EventCard
        event={events[0]}
        position={0}
        source="chat"
        variant="hero"
        commentary={commentary}
        tips={tips}
      />
    )
  }

  return (
    <div className="space-y-3 sm:space-y-0">
      {events.map((event, index) => (
        <EventCard
          key={event.id}
          event={event}
          position={index}
          source="chat"
          variant="default"
        />
      ))}
    </div>
  )
}
