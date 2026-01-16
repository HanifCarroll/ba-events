import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState, useCallback } from 'react'
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  MapPin,
  ExternalLink,
  AlertTriangle,
  Loader2,
  ArrowRightLeft,
} from 'lucide-react'
import { toast } from 'sonner'
import * as m from '@/paraglide/messages'
import { Button } from '@/shared/ui/button'
import { Badge } from '@/shared/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { Combobox } from '@/shared/ui/combobox'
import {
  listVenueReviewQueueAction,
  approveVenueReviewAction,
  rejectVenueReviewAction,
  mergeVenueReviewAction,
} from '@/features/import'
import { listVenues } from '@/features/venues/api/crud'
import type { VenueReviewQueueWithDetails, Venue } from '@/shared/lib/types'

export const Route = createFileRoute('/admin/scraping/venues-review')({
  loader: async () => {
    const [queueData, venues] = await Promise.all([
      listVenueReviewQueueAction({ data: { status: 'pending' } }),
      listVenues(),
    ])
    return { queueData, venues }
  },
  component: VenueReviewPage,
})

function VenueReviewPage() {
  const { queueData, venues } = Route.useLoaderData()
  const router = useRouter()
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [mergeDialogItem, setMergeDialogItem] = useState<VenueReviewQueueWithDetails | null>(null)
  const [selectedMergeVenueId, setSelectedMergeVenueId] = useState<string | undefined>()

  // Venue options for merge dialog
  const venueOptions = venues.map((v: Venue) => ({
    value: v.id,
    label: v.neighborhood ? `${v.name} (${v.neighborhood})` : v.name,
  }))

  const handleApprove = useCallback(
    async (item: VenueReviewQueueWithDetails) => {
      if (!item.best_match_venue_id) {
        toast.error('No venue match to approve')
        return
      }

      setProcessingId(item.id)
      try {
        await approveVenueReviewAction({
          data: { id: item.id, venueId: item.best_match_venue_id },
        })
        toast.success('Venue match approved')
        router.invalidate()
      } catch (error) {
        toast.error('Failed to approve venue match')
        console.error(error)
      } finally {
        setProcessingId(null)
      }
    },
    [router]
  )

  const handleReject = useCallback(
    async (item: VenueReviewQueueWithDetails) => {
      setProcessingId(item.id)
      try {
        await rejectVenueReviewAction({ data: { id: item.id } })
        toast.success('Venue match rejected')
        router.invalidate()
      } catch (error) {
        toast.error('Failed to reject venue match')
        console.error(error)
      } finally {
        setProcessingId(null)
      }
    },
    [router]
  )

  const handleMerge = useCallback(async () => {
    if (!mergeDialogItem || !selectedMergeVenueId) return

    setProcessingId(mergeDialogItem.id)
    try {
      await mergeVenueReviewAction({
        data: { id: mergeDialogItem.id, targetVenueId: selectedMergeVenueId },
      })
      toast.success('Venue merged successfully')
      setMergeDialogItem(null)
      setSelectedMergeVenueId(undefined)
      router.invalidate()
    } catch (error) {
      toast.error('Failed to merge venue')
      console.error(error)
    } finally {
      setProcessingId(null)
    }
  }, [mergeDialogItem, selectedMergeVenueId, router])

  const openMergeDialog = useCallback((item: VenueReviewQueueWithDetails) => {
    setMergeDialogItem(item)
    setSelectedMergeVenueId(item.best_match_venue_id ?? undefined)
  }, [])

  const formatConfidence = (confidence: number | null) => {
    if (confidence === null) return 'N/A'
    return `${Math.round(confidence * 100)}%`
  }

  const getConfidenceBadgeClass = (confidence: number | null) => {
    if (confidence === null) return 'bg-muted text-muted-foreground'
    if (confidence >= 0.8) return 'bg-green-500/20 text-green-400 border-green-500/30'
    if (confidence >= 0.7) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    return 'bg-orange-500/20 text-orange-400 border-orange-500/30'
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in-up p-6">
      {/* Header */}
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
          <Link to="/admin/scraping">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Scraping Dashboard
          </Link>
        </Button>

        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-yellow-500" />
            Venue Review Queue
          </h1>
          <p className="text-muted-foreground mt-1">
            {queueData.entries.length === 0
              ? 'No venues pending review'
              : `${queueData.entries.length} venue${queueData.entries.length === 1 ? '' : 's'} awaiting review`}
          </p>
        </div>
      </div>

      <div className="deco-line w-24" />

      {/* Empty State */}
      {queueData.entries.length === 0 ? (
        <Card className="bg-card/50 border-border/50">
          <CardContent className="text-center py-12">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <h3 className="font-display text-lg font-medium text-foreground mb-2">
              All caught up!
            </h3>
            <p className="text-muted-foreground">
              No venue matches need review. New entries will appear here when the automated scraper
              finds venues with medium confidence matches (60-84%).
            </p>
          </CardContent>
        </Card>
      ) : (
        /* Queue Items */
        <div className="space-y-4">
          {queueData.entries.map((item: VenueReviewQueueWithDetails) => (
            <Card key={item.id} className="bg-card/50 border-border/50">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-lg font-medium text-foreground">
                      {item.source_venue_name}
                    </CardTitle>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <Badge variant="outline" className="text-xs border-border/50">
                        {item.source}
                      </Badge>
                      {item.source_address && (
                        <span className="text-sm text-muted-foreground flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" />
                          {item.source_address}
                        </span>
                      )}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={getConfidenceBadgeClass(item.match_confidence)}
                  >
                    {formatConfidence(item.match_confidence)} match
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Suggested Match */}
                {item.best_match_venue_id && item.best_match_venue_name && (
                  <div className="bg-muted/30 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground mb-1.5">Suggested Match:</p>
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        to="/admin/venues/$id"
                        params={{ id: item.best_match_venue_id }}
                        className="text-sm font-medium text-primary hover:underline flex items-center gap-1"
                      >
                        {item.best_match_venue_name}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </div>
                )}

                {/* Events count */}
                {item.source_event_ids && item.source_event_ids.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {item.source_event_ids.length} event
                    {item.source_event_ids.length === 1 ? '' : 's'} will be updated
                  </p>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 pt-2 border-t border-border/30">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleApprove(item)}
                    disabled={
                      processingId === item.id || !item.best_match_venue_id
                    }
                    className="flex-1 text-green-500 border-green-500/30 hover:bg-green-500/10"
                  >
                    {processingId === item.id ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <CheckCircle className="h-4 w-4 mr-2" />
                    )}
                    Approve Match
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openMergeDialog(item)}
                    disabled={processingId === item.id}
                    className="flex-1 text-blue-500 border-blue-500/30 hover:bg-blue-500/10"
                  >
                    <ArrowRightLeft className="h-4 w-4 mr-2" />
                    Different Venue
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleReject(item)}
                    disabled={processingId === item.id}
                    className="flex-1 text-destructive border-destructive/30 hover:bg-destructive/10"
                  >
                    {processingId === item.id ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <XCircle className="h-4 w-4 mr-2" />
                    )}
                    Reject
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Merge Dialog */}
      <Dialog open={!!mergeDialogItem} onOpenChange={() => setMergeDialogItem(null)}>
        <DialogContent className="bg-card border-border/50">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">Select Different Venue</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Choose a venue to merge "{mergeDialogItem?.source_venue_name}" into.
              All associated events will be updated to use this venue.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Combobox
              options={venueOptions}
              value={selectedMergeVenueId}
              onValueChange={setSelectedMergeVenueId}
              placeholder="Search venues..."
              emptyText="No venues found"
              className="w-full"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => setMergeDialogItem(null)}
              className="text-muted-foreground"
            >
              {m.common_cancel()}
            </Button>
            <Button onClick={handleMerge} disabled={!selectedMergeVenueId || processingId !== null}>
              {processingId === mergeDialogItem?.id ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Merging...
                </>
              ) : (
                <>
                  <ArrowRightLeft className="h-4 w-4 mr-2" />
                  Merge to Selected Venue
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
