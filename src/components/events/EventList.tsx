import { EventCard } from './EventCard'
import type { EventWithVenue } from '@/lib/types'

interface EventListProps {
  events: EventWithVenue[]
  maxDisplay?: number
}

export function EventList({ events, maxDisplay = 5 }: EventListProps) {
  const displayEvents = events.slice(0, maxDisplay)
  const hasMore = events.length > maxDisplay

  return (
    <div className="space-y-2">
      {displayEvents.map((event) => (
        <EventCard key={event.id} event={event} />
      ))}

      {hasMore && (
        <p className="text-xs text-muted-foreground text-center py-2">
          +{events.length - maxDisplay} more events
        </p>
      )}
    </div>
  )
}
