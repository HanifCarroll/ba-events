import { useState } from 'react'
import {
  RefreshCw,
  CheckCircle2,
  Pencil,
  Loader2,
  Play,
  Calendar,
  ExternalLink,
  Link2,
  Trash2,
  Check,
} from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Button } from '@/shared/ui/button'
import { Card } from '@/shared/ui/card'
import { Badge } from '@/shared/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import type { AddressLikeVenue } from '@/features/venues/hooks/useVenueReview'
import type { VenueEventPreview } from '@/features/venues/api/review'
import { useDeleteVenue } from '@/features/venues/hooks/useVenueMutations'
import type { Venue } from '@/shared/lib/types'
import { formatShortDate } from '@/shared/lib/utils/formatting'
import { EditVenueDialog } from './EditVenueDialog'
import * as m from '@/paraglide/messages'

interface VenueAddressNamesPanelProps {
  venues: AddressLikeVenue[]
  venueEvents: Record<string, VenueEventPreview[]>
  isLoading: boolean
  hasStarted: boolean
  onRefresh: () => void
  onStart: () => void
  onConfirmVenue: (venueId: string) => void
  isConfirmingVenue: boolean
}

export function VenueAddressNamesPanel({
  venues,
  venueEvents,
  isLoading,
  hasStarted,
  onRefresh,
  onStart,
  onConfirmVenue,
  isConfirmingVenue,
}: VenueAddressNamesPanelProps) {
  const [editingVenue, setEditingVenue] = useState<Venue | null>(null)
  const [editingSuggestedName, setEditingSuggestedName] = useState<string | undefined>()
  const [deletingVenue, setDeletingVenue] = useState<Venue | null>(null)
  const deleteMutation = useDeleteVenue()

  const handleEdit = (venue: Venue, suggestedName?: string) => {
    setEditingVenue(venue)
    setEditingSuggestedName(suggestedName)
  }

  const handleCloseEdit = () => {
    setEditingVenue(null)
    setEditingSuggestedName(undefined)
  }

  const handleDelete = async () => {
    if (!deletingVenue) return
    try {
      await deleteMutation.mutateAsync(deletingVenue.id)
      setDeletingVenue(null)
    } catch {
      // Error handled by mutation
    }
  }

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
                <div className="flex items-center gap-2 ml-4">
                  <Badge variant="secondary">
                    {m.admin_confidence({ percent: Math.round(confidence * 100) })}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-green-600 hover:text-green-700 hover:bg-green-50"
                    onClick={() => onConfirmVenue(venue.id)}
                    disabled={isConfirmingVenue}
                    title="Mark as valid venue name (not an address)"
                  >
                    <Check className="h-4 w-4 mr-1" />
                    Not an Address
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleEdit(venue, suggestedName)}
                  >
                    <Pencil className="h-4 w-4 mr-1" />
                    {m.common_edit()}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setDeletingVenue(venue)}
                  >
                    <Trash2 className="h-4 w-4" />
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

      {/* Edit Dialog */}
      <EditVenueDialog
        venue={editingVenue}
        suggestedName={editingSuggestedName}
        onClose={handleCloseEdit}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingVenue} onOpenChange={() => setDeletingVenue(null)}>
        <AlertDialogContent className="bg-card border-border/50">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-foreground">
              {m.admin_delete_venue()}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              {deletingVenue &&
                m.admin_delete_venue_confirm({ name: deletingVenue.name })}
              {deletingVenue && venueEvents[deletingVenue.id]?.length > 0 && (
                <span className="block mt-2 text-amber-500">
                  {m.admin_delete_venue_warning({
                    count: venueEvents[deletingVenue.id].length,
                  })}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-muted-foreground">
              {m.common_cancel()}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {m.common_deleting()}
                </>
              ) : (
                m.common_delete()
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
