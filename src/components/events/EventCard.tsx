import { useState } from 'react'
import { ChevronDown, ChevronUp, Calendar, MapPin, Clock } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { EventActions } from './EventActions'
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

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="overflow-hidden">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="w-full p-0 h-auto hover:bg-accent/50 rounded-none"
          >
            <CardContent className="p-4 w-full">
              {/* Compact view */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 text-left">
                  <h3 className="font-semibold text-sm line-clamp-1">
                    {event.name}
                  </h3>
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {event.venue_name}
                    </span>
                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {dateStr}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={event.is_free ? 'secondary' : 'outline'}>
                    {formatPrice(event.price, event.is_free)}
                  </Badge>
                  {isOpen ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </div>
            </CardContent>
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0 pb-4 px-4 border-t">
            {/* Expanded view */}
            <div className="pt-3 space-y-3">
              {/* Description */}
              {event.description && (
                <p className="text-sm text-muted-foreground">
                  {event.description}
                </p>
              )}

              {/* Details grid */}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  <span>{formatEventTime(event.starts_at, event.ends_at)}</span>
                </div>
                {event.venue_neighborhood && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="h-4 w-4" />
                    <span>{event.venue_neighborhood}</span>
                  </div>
                )}
                {event.min_age && (
                  <div className="text-muted-foreground">
                    {event.min_age}+ only
                  </div>
                )}
              </div>

              {/* Categories & vibes */}
              <div className="flex flex-wrap gap-1">
                {event.categories.slice(0, 3).map((cat) => (
                  <Badge key={cat} variant="secondary" className="text-xs">
                    {cat}
                  </Badge>
                ))}
                {event.vibes.slice(0, 2).map((vibe) => (
                  <Badge key={vibe} variant="outline" className="text-xs">
                    {vibe}
                  </Badge>
                ))}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-2">
                <EventActions event={event} />
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
