import { useEffect, useState } from 'react'
import {
  Sparkles,
  Loader2,
  CheckCircle2,
  MapPin,
  FileText,
  AlertCircle,
  LinkIcon,
  RotateCcw,
  Home,
} from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Progress } from '@/shared/ui/progress'
import { Badge } from '@/shared/ui/badge'
import {
  getNeedsAttentionBreakdownAction,
  resetFailedEnrichmentsAction,
  type NeedsAttentionBreakdown,
} from '@/features/events'
import { getAllPendingVenuesAction } from '@/features/venues/api/enrichment'
import {
  useAutoEnrichment,
  useTriggerEnrichment,
  type VenueToEnrich,
} from '@/features/import'

export function BackfillCard() {
  const [breakdown, setBreakdown] = useState<NeedsAttentionBreakdown | null>(null)
  const [pendingVenues, setPendingVenues] = useState<number>(0)
  const [isLoadingCounts, setIsLoadingCounts] = useState(true)
  const [isResettingFailed, setIsResettingFailed] = useState(false)

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
      const [breakdownData, venues] = await Promise.all([
        getNeedsAttentionBreakdownAction(),
        getAllPendingVenuesAction(),
      ])
      setBreakdown(breakdownData)
      setPendingVenues(venues.length)
    } catch (error) {
      console.error('[backfill] Failed to fetch counts:', error)
      setBreakdown({
        readyForEnrichment: 0,
        missingVenueOnly: 0,
        enrichmentFailed: 0,
        noLink: 0,
      })
      setPendingVenues(0)
    } finally {
      setIsLoadingCounts(false)
    }
  }

  useEffect(() => {
    fetchCounts()
  }, [])

  const handleEnrichAll = async () => {
    // Start event enrichment via Trigger.dev (now includes venue extraction)
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

  const handleRetryFailed = async () => {
    setIsResettingFailed(true)
    try {
      await resetFailedEnrichmentsAction()
      await fetchCounts()
      // Auto-start enrichment after resetting
      eventEnrichment.trigger({ limit: 200 })
    } catch (error) {
      console.error('[backfill] Failed to reset failed enrichments:', error)
    } finally {
      setIsResettingFailed(false)
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
  const isComplete =
    (isEventComplete || !isEventEnriching) &&
    (isVenueComplete || !isVenueEnriching) &&
    (isEventComplete || isVenueComplete)

  // Calculate if there's anything to show
  const totalEventIssues = breakdown
    ? breakdown.readyForEnrichment + breakdown.missingVenueOnly + breakdown.enrichmentFailed + breakdown.noLink
    : 0
  const hasPending = totalEventIssues > 0 || pendingVenues > 0

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
            <CardTitle className="text-lg">Data Quality</CardTitle>
          </div>
          {isEventEnriching && (
            <Badge variant="outline" className="text-amber-600 border-amber-500/30">
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              Running in background
            </Badge>
          )}
        </div>
        <CardDescription>Events and venues that need attention</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Breakdown Categories - show when idle */}
        {!isEnriching && !isEventComplete && !isVenueComplete && !isEventFailed && (
          <div className="space-y-3">
            {/* Ready for Enrichment */}
            {(breakdown?.readyForEnrichment ?? 0) > 0 && (
              <div className="flex items-center justify-between p-3 bg-green-500/10 rounded-lg border border-green-500/20">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Ready for Enrichment</p>
                    <p className="text-xs text-muted-foreground">Missing description or venue, has link</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-green-600">
                    {isLoadingCounts ? '...' : breakdown?.readyForEnrichment ?? 0}
                  </span>
                  <Button
                    size="sm"
                    onClick={handleEnrichEvents}
                    disabled={isLoadingCounts}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    <Sparkles className="h-3 w-3 mr-1" />
                    Enrich
                  </Button>
                </div>
              </div>
            )}

            {/* Missing Venue Only */}
            {(breakdown?.missingVenueOnly ?? 0) > 0 && (
              <div className="flex items-center justify-between p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                <div className="flex items-center gap-3">
                  <Home className="h-5 w-5 text-blue-600" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Missing Venue Only</p>
                    <p className="text-xs text-muted-foreground">Description done, needs venue extraction</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-blue-600">
                    {isLoadingCounts ? '...' : breakdown?.missingVenueOnly ?? 0}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleEnrichEvents}
                    disabled={isLoadingCounts}
                    className="border-blue-500/30 text-blue-600 hover:bg-blue-500/10"
                  >
                    <Home className="h-3 w-3 mr-1" />
                    Extract
                  </Button>
                </div>
              </div>
            )}

            {/* Enrichment Failed */}
            {(breakdown?.enrichmentFailed ?? 0) > 0 && (
              <div className="flex items-center justify-between p-3 bg-red-500/10 rounded-lg border border-red-500/20">
                <div className="flex items-center gap-3">
                  <AlertCircle className="h-5 w-5 text-red-600" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Enrichment Failed</p>
                    <p className="text-xs text-muted-foreground">Previous errors - can retry</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-red-600">
                    {isLoadingCounts ? '...' : breakdown?.enrichmentFailed ?? 0}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRetryFailed}
                    disabled={isLoadingCounts || isResettingFailed}
                    className="border-red-500/30 text-red-600 hover:bg-red-500/10"
                  >
                    {isResettingFailed ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3 w-3 mr-1" />
                    )}
                    Retry
                  </Button>
                </div>
              </div>
            )}

            {/* No Link */}
            {(breakdown?.noLink ?? 0) > 0 && (
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border border-border/50">
                <div className="flex items-center gap-3">
                  <LinkIcon className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium text-foreground">No Link</p>
                    <p className="text-xs text-muted-foreground">Requires manual entry</p>
                  </div>
                </div>
                <span className="text-lg font-bold text-muted-foreground">
                  {isLoadingCounts ? '...' : breakdown?.noLink ?? 0}
                </span>
              </div>
            )}

            {/* Pending Venues (separate system) */}
            {pendingVenues > 0 && (
              <div className="flex items-center justify-between p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
                <div className="flex items-center gap-3">
                  <MapPin className="h-5 w-5 text-amber-600" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Venues Pending</p>
                    <p className="text-xs text-muted-foreground">Need website/social enrichment</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-amber-600">
                    {isLoadingCounts ? '...' : pendingVenues}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleEnrichVenues}
                    disabled={isLoadingCounts}
                    className="border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
                  >
                    <MapPin className="h-3 w-3 mr-1" />
                    Enrich
                  </Button>
                </div>
              </div>
            )}

            {/* Enrich All Button */}
            {hasPending && (
              <Button
                onClick={handleEnrichAll}
                className="w-full bg-primary text-primary-foreground"
                disabled={isLoadingCounts}
              >
                <Sparkles className="h-4 w-4 mr-2" />
                Enrich All
              </Button>
            )}
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
