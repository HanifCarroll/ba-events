import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Loader2, ChevronDown, ChevronUp, Calendar, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { getVenueEventsAction, type VenueEventPreview } from '@/lib/admin'
import { formatDateTime } from '@/lib/utils/formatting'
import type { DuplicateGroup } from '@/hooks/useVenueReview'
import type { Venue } from '@/lib/types'
import * as m from '@/paraglide/messages'

interface MergeVenueDialogProps {
  group: DuplicateGroup | null
  eventCounts: Record<string, number>
  onConfirm: (sourceId: string, targetId: string) => void
  onCancel: () => void
  isLoading: boolean
}

export function MergeVenueDialog({
  group,
  eventCounts,
  onConfirm,
  onCancel,
  isLoading,
}: MergeVenueDialogProps) {
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null)
  const [expandedVenueIds, setExpandedVenueIds] = useState<Set<string>>(new Set())

  // Reset selection when group changes
  useEffect(() => {
    if (group) {
      setSelectedTargetId(group.primaryVenue.id)
      setExpandedVenueIds(new Set())
    }
  }, [group])

  // All venues in the group (primary + duplicates)
  const allVenues: Array<{ venue: Venue; similarity: number }> = group
    ? [{ venue: group.primaryVenue, similarity: 1 }, ...group.duplicates]
    : []

  const venueIds = allVenues.map((v) => v.venue.id)

  // Fetch events for all venues in the group
  const { data: eventsByVenue, isLoading: isLoadingEvents } = useQuery({
    queryKey: ['venue-events-preview', venueIds.join(',')],
    queryFn: () => getVenueEventsAction({ data: venueIds }),
    enabled: !!group && venueIds.length > 0,
    staleTime: 0, // Always refetch to ensure fresh data
    gcTime: 0, // Don't cache results
  })

  if (!group) return null

  const targetVenue = allVenues.find((v) => v.venue.id === selectedTargetId)?.venue
  const sourceVenues = allVenues.filter((v) => v.venue.id !== selectedTargetId)
  const totalEventsToMove = sourceVenues.reduce(
    (sum, v) => sum + (eventCounts[v.venue.id] ?? 0),
    0
  )

  const handleConfirm = () => {
    if (!targetVenue || sourceVenues.length === 0) return
    // For simplicity, merge the first source venue. If there are multiple duplicates,
    // the user can merge them one by one.
    onConfirm(sourceVenues[0].venue.id, targetVenue.id)
  }

  const toggleExpanded = (venueId: string) => {
    setExpandedVenueIds((prev) => {
      const next = new Set(prev)
      if (next.has(venueId)) {
        next.delete(venueId)
      } else {
        next.add(venueId)
      }
      return next
    })
  }

  const isExpanded = (venueId: string) => expandedVenueIds.has(venueId)

  return (
    <Dialog open={!!group} onOpenChange={() => onCancel()}>
      <DialogContent className="bg-card border-border/50 max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-foreground">
            {m.admin_merge_venues()}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {m.admin_merge_venues_desc()}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm font-medium text-foreground">{m.admin_select_venue_to_keep()}:</p>
          <RadioGroup
            value={selectedTargetId ?? ''}
            onValueChange={setSelectedTargetId}
            className="space-y-3"
          >
            {allVenues.map(({ venue }) => {
              const events = eventsByVenue?.[venue.id] ?? []
              const eventCount = eventCounts[venue.id] ?? 0
              const venueIsExpanded = isExpanded(venue.id)

              return (
                <Collapsible key={venue.id} open={venueIsExpanded}>
                  <div className="border border-border/50 rounded-lg overflow-hidden">
                    <div className="flex items-center space-x-3 p-3 hover:bg-muted/30 transition-colors">
                      <RadioGroupItem value={venue.id} id={venue.id} />
                      <Label htmlFor={venue.id} className="flex-1 cursor-pointer">
                        <p className="font-medium text-foreground">{venue.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {venue.neighborhood} &bull;{' '}
                          {eventCount === 1
                            ? m.admin_event_count_singular()
                            : m.admin_events_count({ count: eventCount })}
                        </p>
                      </Label>
                      {eventCount > 0 && (
                        <CollapsibleTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-muted-foreground hover:text-foreground"
                            onClick={(e) => {
                              e.preventDefault()
                              toggleExpanded(venue.id)
                            }}
                          >
                            {isLoadingEvents ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : venueIsExpanded ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </Button>
                        </CollapsibleTrigger>
                      )}
                    </div>
                    <CollapsibleContent>
                      <div className="border-t border-border/30 bg-muted/20 p-3 space-y-2">
                        {isLoadingEvents ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {m.common_loading()}
                          </div>
                        ) : events.length === 0 ? (
                          <p className="text-sm text-muted-foreground italic">
                            {m.admin_no_events()}
                          </p>
                        ) : (
                          events.slice(0, 5).map((event) => (
                            <EventPreviewItem key={event.id} event={event} />
                          ))
                        )}
                        {events.length > 5 && (
                          <p className="text-xs text-muted-foreground pt-1">
                            {m.admin_and_more_events({ count: events.length - 5 })}
                          </p>
                        )}
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              )
            })}
          </RadioGroup>
        </div>

        {targetVenue && sourceVenues.length > 0 && (
          <div className="bg-muted/30 p-3 rounded-lg text-sm space-y-1">
            <p className="text-foreground">
              <strong>{totalEventsToMove}</strong> {m.admin_events_will_be_moved()}{' '}
              &ldquo;{targetVenue.name}&rdquo;.
            </p>
            <p className="text-destructive">
              {sourceVenues.length === 1
                ? m.admin_venue_will_be_deleted({ name: sourceVenues[0].venue.name })
                : m.admin_venues_will_be_deleted({ count: sourceVenues.length })}
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={onCancel} className="text-muted-foreground">
            {m.common_cancel()}
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!targetVenue || sourceVenues.length === 0 || isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {m.admin_merging()}
              </>
            ) : (
              m.admin_merge_venues()
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

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
