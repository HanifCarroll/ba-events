import { useEffect, useState } from 'react'
import { Sparkles, Loader2, CheckCircle2, MapPin, FileText, AlertCircle } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Progress } from '@/shared/ui/progress'
import { Badge } from '@/shared/ui/badge'
import { getPendingEnrichmentCountsAction } from '@/features/events'
import { getAllPendingVenuesAction } from '@/features/venues/api/enrichment'
import {
  useAutoEnrichment,
  useTriggerEnrichment,
  type VenueToEnrich,
} from '@/features/import'

export function BackfillCard() {
  const [pendingCounts, setPendingCounts] = useState<{ events: number; venues: number } | null>(null)
  const [isLoadingCounts, setIsLoadingCounts] = useState(true)

  // Trigger.dev-based enrichment for events (long-running, background job)
  const eventEnrichment = useTriggerEnrichment({
    onComplete: () => {
      fetchCounts()
    },
  })

  // Streaming-based enrichment for venues (faster, works with Netlify timeout)
  const venueEnrichment = useAutoEnrichment({
    onComplete: () => {
      fetchCounts()
    },
  })

  const fetchCounts = async () => {
    setIsLoadingCounts(true)
    try {
      const counts = await getPendingEnrichmentCountsAction()
      setPendingCounts({
        events: counts.pendingEvents,
        venues: counts.pendingVenues,
      })
    } catch (error) {
      console.error('[backfill] Failed to fetch pending counts:', error)
      setPendingCounts({ events: 0, venues: 0 })
    } finally {
      setIsLoadingCounts(false)
    }
  }

  useEffect(() => {
    fetchCounts()
  }, [])

  const handleEnrichAll = async () => {
    // Start event enrichment via Trigger.dev
    eventEnrichment.trigger({ limit: 200 })

    // Start venue enrichment via streaming (runs in parallel)
    try {
      const venues = await getAllPendingVenuesAction()
      const venuesToEnrich: VenueToEnrich[] = venues.map((v) => ({
        venueId: v.id,
        venueName: v.name,
      }))
      if (venuesToEnrich.length > 0) {
        venueEnrichment.startVenueEnrichment(venuesToEnrich)
      }
    } catch (error) {
      console.error('[backfill] Failed to start venue enrichment:', error)
    }
  }

  const handleEnrichEvents = async () => {
    // Use Trigger.dev for event enrichment (avoids Netlify timeout)
    eventEnrichment.trigger({ limit: 200 })
  }

  const handleEnrichVenues = async () => {
    try {
      const venues = await getAllPendingVenuesAction()
      const venuesToEnrich: VenueToEnrich[] = venues.map((v) => ({
        venueId: v.id,
        venueName: v.name,
      }))
      venueEnrichment.startVenueEnrichment(venuesToEnrich)
    } catch (error) {
      console.error('[backfill] Failed to start venue enrichment:', error)
    }
  }

  // Determine overall state
  const isEventEnriching = eventEnrichment.isEnriching
  const isEventComplete = eventEnrichment.status === 'completed'
  const isEventFailed = eventEnrichment.status === 'failed'

  const venueState = venueEnrichment.state
  const isVenueEnriching = venueState.phase === 'venues'
  const isVenueComplete = venueState.phase === 'complete' && venueState.venueResult !== null

  const isEnriching = isEventEnriching || isVenueEnriching
  const isComplete = (isEventComplete || !isEventEnriching) && (isVenueComplete || !isVenueEnriching) && (isEventComplete || isVenueComplete)
  const hasPending = pendingCounts && (pendingCounts.events > 0 || pendingCounts.venues > 0)

  // Calculate event progress percentage
  const eventProgressPercent = eventEnrichment.progress
    ? (eventEnrichment.progress.current / eventEnrichment.progress.total) * 100
    : 0

  // Don't show card if nothing pending and not enriching and no results
  if (!isLoadingCounts && !hasPending && !isEnriching && !isEventComplete && !isVenueComplete && !isEventFailed) {
    return null
  }

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Enrichment Backfill</CardTitle>
          </div>
          {isEventEnriching && (
            <Badge variant="outline" className="text-amber-600 border-amber-500/30">
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              Running in background
            </Badge>
          )}
        </div>
        <CardDescription>
          Enrich events and venues that are missing data
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Pending Counts - show when idle */}
        {!isEnriching && !isEventComplete && !isVenueComplete && !isEventFailed && (
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-3 p-3 bg-card/50 rounded-lg border border-border/50">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold text-foreground">
                  {isLoadingCounts ? '...' : pendingCounts?.events ?? 0}
                </p>
                <p className="text-xs text-muted-foreground">Events pending</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 bg-card/50 rounded-lg border border-border/50">
              <MapPin className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold text-foreground">
                  {isLoadingCounts ? '...' : pendingCounts?.venues ?? 0}
                </p>
                <p className="text-xs text-muted-foreground">Venues pending</p>
              </div>
            </div>
          </div>
        )}

        {/* Event Enrichment Progress (Trigger.dev) */}
        {(isEventEnriching || isEventComplete || isEventFailed) && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Events</span>
              </span>
              {isEventEnriching && eventEnrichment.progress && (
                <span className="text-muted-foreground">
                  {eventEnrichment.progress.current}/{eventEnrichment.progress.total}
                </span>
              )}
              {isEventComplete && eventEnrichment.result && (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-green-600 border-green-500/30">
                    {eventEnrichment.result.enriched} enriched
                  </Badge>
                  {eventEnrichment.result.failed > 0 && (
                    <Badge variant="outline" className="text-red-600 border-red-500/30">
                      {eventEnrichment.result.failed} failed
                    </Badge>
                  )}
                </div>
              )}
              {isEventFailed && (
                <Badge variant="outline" className="text-red-600 border-red-500/30">
                  <AlertCircle className="h-3 w-3 mr-1" />
                  Failed
                </Badge>
              )}
            </div>
            {isEventEnriching && eventEnrichment.progress && (
              <>
                <Progress value={eventProgressPercent} className="h-2" />
                {eventEnrichment.progress.currentEvent && (
                  <p className="text-xs text-muted-foreground truncate">
                    Processing: {eventEnrichment.progress.currentEvent}
                  </p>
                )}
              </>
            )}
            {isEventFailed && eventEnrichment.error && (
              <p className="text-xs text-red-600">{eventEnrichment.error}</p>
            )}
          </div>
        )}

        {/* Venue Enrichment Progress (Streaming) */}
        {(isVenueEnriching || venueState.venueResult) && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Venues</span>
              </span>
              {isVenueEnriching && venueState.venueProgress && (
                <span className="text-muted-foreground">
                  {venueState.venueProgress.current}/{venueState.venueProgress.total}
                </span>
              )}
              {venueState.venueResult && (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-green-600 border-green-500/30">
                    {venueState.venueResult.enriched} enriched
                  </Badge>
                  {venueState.venueResult.failed > 0 && (
                    <Badge variant="outline" className="text-red-600 border-red-500/30">
                      {venueState.venueResult.failed} failed
                    </Badge>
                  )}
                </div>
              )}
            </div>
            {isVenueEnriching && venueState.venueProgress && (
              <Progress
                value={(venueState.venueProgress.current / venueState.venueProgress.total) * 100}
                className="h-2"
              />
            )}
          </div>
        )}

        {/* Complete Message */}
        {isComplete && !isEnriching && (
          <div className="flex items-center gap-2 text-sm text-green-600 pt-2 border-t border-border/30">
            <CheckCircle2 className="h-4 w-4" />
            <span>Enrichment complete</span>
          </div>
        )}

        {/* Action Buttons */}
        {!isEnriching && !isEventComplete && !isVenueComplete && !isEventFailed && hasPending && (
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              onClick={handleEnrichAll}
              className="bg-primary text-primary-foreground"
              disabled={isLoadingCounts}
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Enrich All
            </Button>
            {pendingCounts && pendingCounts.events > 0 && (
              <Button
                variant="outline"
                onClick={handleEnrichEvents}
                disabled={isLoadingCounts}
                className="border-primary/30 text-primary hover:bg-primary/10"
              >
                <FileText className="h-4 w-4 mr-2" />
                Events Only
              </Button>
            )}
            {pendingCounts && pendingCounts.venues > 0 && (
              <Button
                variant="outline"
                onClick={handleEnrichVenues}
                disabled={isLoadingCounts}
                className="border-primary/30 text-primary hover:bg-primary/10"
              >
                <MapPin className="h-4 w-4 mr-2" />
                Venues Only
              </Button>
            )}
          </div>
        )}

        {/* Reset after complete or failed */}
        {(isComplete || isEventFailed) && !isEnriching && (
          <Button
            variant="outline"
            onClick={() => {
              eventEnrichment.reset()
              venueEnrichment.reset()
              fetchCounts()
            }}
            className="w-full"
          >
            <Loader2 className="h-4 w-4 mr-2" />
            Check for More
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
