import { RefreshCw, CheckCircle2, GitMerge, Loader2, X, Eye, Calendar, ExternalLink } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import { Badge } from '@/shared/ui/badge'
import { getVenueEventsAction, type VenueEventPreview } from '@/features/venues/api/review'
import type { DuplicateGroup } from '@/features/venues/hooks/useVenueReview'
import { formatDateTime } from '@/shared/lib/utils/formatting'
import * as m from '@/paraglide/messages'

interface VenueDuplicatesPanelProps {
  groups: DuplicateGroup[]
  eventCounts: Record<string, number>
  isLoading: boolean
  onMerge: (group: DuplicateGroup) => void
  onRefresh: () => void
  onDismiss: (venueId1: string, venueId2: string) => void
  onShowDismissed: () => void
  dismissedCount: number
  isDismissing: boolean
}

// Event preview item component (same as in MergeVenueDialog)
function EventPreviewItem({ event }: { event: VenueEventPreview }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <Calendar className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Link
            to="/admin/events/$id"
            params={{ id: event.id }}
            target="_blank"
            className="font-medium text-foreground hover:text-primary hover:underline truncate"
            title="Edit in app"
          >
            {event.name}
          </Link>
          {event.link && (
            <a
              href={event.link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-primary shrink-0"
              title="View original source"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {formatDateTime(event.starts_at)}
        </p>
      </div>
    </div>
  )
}

// Event list for a venue
function VenueEventsList({ events, isLoading }: { events: VenueEventPreview[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        {m.common_loading()}
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic py-1">
        {m.admin_no_events()}
      </p>
    )
  }

  return (
    <div className="space-y-2 py-1">
      {events.slice(0, 5).map((event) => (
        <EventPreviewItem key={event.id} event={event} />
      ))}
      {events.length > 5 && (
        <p className="text-xs text-muted-foreground pt-1">
          {m.admin_and_more_events({ count: events.length - 5 })}
        </p>
      )}
    </div>
  )
}

export function VenueDuplicatesPanel({
  groups,
  eventCounts,
  isLoading,
  onMerge,
  onRefresh,
  onDismiss,
  onShowDismissed,
  dismissedCount,
  isDismissing,
}: VenueDuplicatesPanelProps) {
  // Get all venue IDs from all groups for event fetching
  const allVenueIds = groups.flatMap((group) => [
    group.primaryVenue.id,
    ...group.duplicates.map((d) => d.venue.id),
  ])

  // Fetch events for all venues in duplicate groups
  const { data: eventsByVenue, isLoading: isLoadingEvents } = useQuery({
    queryKey: ['duplicate-venue-events', allVenueIds.join(',')],
    queryFn: () => getVenueEventsAction({ data: allVenueIds }),
    enabled: allVenueIds.length > 0,
    staleTime: 30000, // Cache for 30 seconds
  })

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin mb-4" />
        <p>{m.admin_analyzing_duplicates()}</p>
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 bg-card/50 rounded-xl border border-border/50">
        <CheckCircle2 className="h-12 w-12 text-green-500 mb-4" />
        <h3 className="font-display text-lg font-medium text-foreground mb-2">
          {m.admin_no_duplicates()}
        </h3>
        <p className="text-muted-foreground mb-4">{m.admin_no_duplicates_desc()}</p>
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
        <div className="flex items-center gap-4">
          <p className="text-muted-foreground">
            {m.admin_duplicates_found({ count: groups.length })}
          </p>
          {dismissedCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={onShowDismissed}
            >
              <Eye className="h-4 w-4 mr-1" />
              {m.admin_view_dismissed({ count: dismissedCount })}
            </Button>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => onRefresh()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          {m.admin_re_analyze()}
        </Button>
      </div>

      {groups.map((group) => {
        const primaryEvents = eventsByVenue?.[group.primaryVenue.id] ?? []
        const primaryEventCount = eventCounts[group.primaryVenue.id] ?? 0

        return (
          <Card key={group.primaryVenue.id} className="bg-card/50 border-border/50">
            <CardHeader className="pb-3">
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-lg text-foreground">
                    {group.primaryVenue.name}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    {group.primaryVenue.neighborhood} &bull;{' '}
                    {m.admin_events_count({ count: primaryEventCount })}
                  </p>
                </div>
                <Badge variant="outline" className="border-primary/30 text-primary">
                  {m.admin_suggested()}
                </Badge>
              </div>
              {/* Primary venue events - expanded by default */}
              {primaryEventCount > 0 && (
                <div className="mt-3 pt-3 border-t border-border/30">
                  <VenueEventsList events={primaryEvents} isLoading={isLoadingEvents} />
                </div>
              )}
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-sm text-muted-foreground mb-3">
                {m.admin_duplicates()}:
              </p>
              <div className="space-y-3">
                {group.duplicates.map((dup) => {
                  const dupEvents = eventsByVenue?.[dup.venue.id] ?? []
                  const dupEventCount = eventCounts[dup.venue.id] ?? 0

                  return (
                    <div
                      key={dup.venue.id}
                      className="p-3 bg-muted/30 rounded-lg"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium text-foreground">{dup.venue.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {dup.venue.neighborhood} &bull;{' '}
                            {m.admin_events_count({ count: dupEventCount })}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge variant="secondary">
                            {m.admin_similarity({ percent: Math.round(dup.similarity * 100) })}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => onDismiss(group.primaryVenue.id, dup.venue.id)}
                            disabled={isDismissing}
                            title={m.admin_not_duplicate()}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      {/* Duplicate venue events - expanded by default */}
                      {dupEventCount > 0 && (
                        <div className="mt-3 pt-3 border-t border-border/20">
                          <VenueEventsList events={dupEvents} isLoading={isLoadingEvents} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="mt-4 pt-4 border-t border-border/30">
                <Button size="sm" onClick={() => onMerge(group)}>
                  <GitMerge className="h-4 w-4 mr-2" />
                  {m.admin_merge_venues()}
                </Button>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
