import { EventCard } from './EventCard'
import type { EventWithVenue } from '@/shared/lib/types'

interface EventListProps {
  events: EventWithVenue[]
  /** Commentary for hero card (single recommendation mode) */
  commentary?: string
  /** Tips for hero card (single recommendation mode) */
  tips?: string[]
}

export function EventList({ events, commentary, tips }: EventListProps) {
  const isSingleRecommendation = events.length === 1

  // Single recommendation = hero card with commentary/tips
  if (isSingleRecommendation) {
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

  // Multiple events = default collapsible cards
  return (
    <div className="space-y-3 stagger-children">
      {events.map((event, index) => (
        <EventCard key={event.id} event={event} position={index} source="chat" />
      ))}
    </div>
  )
}
