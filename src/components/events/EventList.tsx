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
    <div className="space-y-3 stagger-children">
      {displayEvents.map((event, index) => (
        <EventCard key={event.id} event={event} position={index} source="chat" />
      ))}

      {hasMore && (
        <div className="text-center py-3">
          <span className="text-xs text-primary/70 tracking-wide">
            +{events.length - maxDisplay} more events found
          </span>
        </div>
      )}
    </div>
  )
}
