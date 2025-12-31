import { RefreshCw, CheckCircle2, Pencil, Loader2, Play, Calendar, ExternalLink, Link2 } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { AddressLikeVenue } from '@/hooks/useVenueReview'
import type { VenueEventPreview } from '@/lib/admin/venue-review'
import type { Venue } from '@/lib/types'
import { formatShortDate } from '@/lib/utils/formatting'
import * as m from '@/paraglide/messages'

interface VenueAddressNamesPanelProps {
  venues: AddressLikeVenue[]
  venueEvents: Record<string, VenueEventPreview[]>
  isLoading: boolean
  hasStarted: boolean
  onRename: (venue: Venue, suggestedName?: string) => void
  onRefresh: () => void
  onStart: () => void
}

export function VenueAddressNamesPanel({
  venues,
  venueEvents,
  isLoading,
  hasStarted,
  onRename,
  onRefresh,
  onStart,
}: VenueAddressNamesPanelProps) {
  // Show start button if analysis hasn't been started yet
  if (!hasStarted && !isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 bg-card/50 rounded-xl border border-border/50">
        <h3 className="font-display text-lg font-medium text-foreground mb-2">
          {m.admin_analyze_address_names()}
        </h3>
        <p className="text-muted-foreground mb-4 text-center max-w-md">
          {m.admin_analyze_address_names_desc()}
        </p>
        <Button onClick={onStart}>
          <Play className="h-4 w-4 mr-2" />
          {m.admin_start_analysis()}
        </Button>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin mb-4" />
        <p>{m.admin_analyzing_names()}</p>
      </div>
    )
  }

  if (venues.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 bg-card/50 rounded-xl border border-border/50">
        <CheckCircle2 className="h-12 w-12 text-green-500 mb-4" />
        <h3 className="font-display text-lg font-medium text-foreground mb-2">
          {m.admin_no_address_names()}
        </h3>
        <p className="text-muted-foreground mb-4">{m.admin_no_address_names_desc()}</p>
        <Button variant="outline" onClick={() => onRefresh()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          {m.admin_re_analyze()}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-muted-foreground">
          {m.admin_address_names_found({ count: venues.length })}
        </p>
        <Button variant="outline" size="sm" onClick={() => onRefresh()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          {m.admin_re_analyze()}
        </Button>
      </div>

      <div className="space-y-3">
        {venues.map(({ venue, confidence, suggestedName }) => {
          const events = venueEvents[venue.id] ?? []
          return (
            <Card key={venue.id} className="p-4 bg-card/50 border-border/50">
              <div className="flex justify-between items-center">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate">{venue.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {venue.neighborhood}
                    {suggestedName && (
                      <span className="ml-2 text-primary">
                        {m.admin_suggested()}: &ldquo;{suggestedName}&rdquo;
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3 ml-4">
                  <Badge variant="secondary">
                    {m.admin_confidence({ percent: Math.round(confidence * 100) })}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onRename(venue, suggestedName)}
                  >
                    <Pencil className="h-4 w-4 mr-1" />
                    {m.admin_rename()}
                  </Button>
                </div>
              </div>

              {/* Events at this venue */}
              {events.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border/30">
                  <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {m.admin_events_at_venue({ count: events.length })}
                  </p>
                  <div className="space-y-1.5">
                    {events.slice(0, 3).map((event) => (
                      <div key={event.id} className="flex items-center gap-2 text-sm">
                        <Link
                          to="/admin/events/$id"
                          params={{ id: event.id }}
                          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors group flex-1 min-w-0"
                        >
                          <ExternalLink className="h-3 w-3 shrink-0 opacity-50 group-hover:opacity-100 transition-opacity" />
                          <span className="truncate">{event.name}</span>
                        </Link>
                        <span className="text-xs text-muted-foreground opacity-60 shrink-0">
                          {formatShortDate(event.starts_at)}
                        </span>
                        {event.link && (
                          <a
                            href={event.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-primary transition-colors shrink-0"
                            title={m.admin_view_source()}
                          >
                            <Link2 className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    ))}
                    {events.length > 3 && (
                      <p className="text-xs text-muted-foreground pl-5">
                        {m.admin_and_more_events({ count: events.length - 3 })}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
