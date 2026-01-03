import { EventCard } from './EventCard'
import type { EventWithVenue } from '@/shared/lib/types'

interface EventListProps {
  events: EventWithVenue[]
}

export function EventList({ events }: EventListProps) {
  return (
    <div className="space-y-3 stagger-children">
      {events.map((event, index) => (
        <EventCard key={event.id} event={event} position={index} source="chat" />
      ))}
    </div>
  )
}
