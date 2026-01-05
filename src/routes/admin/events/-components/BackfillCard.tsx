import { useEffect, useState } from 'react'
import { Sparkles, StopCircle, Loader2, CheckCircle2, MapPin, FileText } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card'
import { Progress } from '@/shared/ui/progress'
import { Badge } from '@/shared/ui/badge'
import {
  getPendingEnrichmentCountsAction,
  getAllPendingEventsAction,
} from '@/features/events'
import { getAllPendingVenuesAction } from '@/features/venues/api/enrichment'
import {
  useAutoEnrichment,
  type EventToEnrich,
  type VenueToEnrich,
} from '@/features/import/hooks/useAutoEnrichment'

export function BackfillCard() {
  const [pendingCounts, setPendingCounts] = useState<{ events: number; venues: number } | null>(null)
  const [isLoadingCounts, setIsLoadingCounts] = useState(true)
  const autoEnrichment = useAutoEnrichment({
    onComplete: () => {
      // Refresh counts after enrichment completes
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
    try {
      const [events, venues] = await Promise.all([
        getAllPendingEventsAction(),
        getAllPendingVenuesAction(),
      ])

      const eventsToEnrich: EventToEnrich[] = events.map((e) => ({
        id: e.id,
        name: e.name,
        link: e.link,
        source: e.source,
      }))

      const venuesToEnrich: VenueToEnrich[] = venues.map((v) => ({
        venueId: v.id,
        venueName: v.name,
      }))

      autoEnrichment.startEnrichment(eventsToEnrich, venuesToEnrich)
    } catch (error) {
      console.error('[backfill] Failed to start enrichment:', error)
    }
  }

  const handleEnrichEvents = async () => {
    try {
      const events = await getAllPendingEventsAction()
      const eventsToEnrich: EventToEnrich[] = events.map((e) => ({
        id: e.id,
        name: e.name,
        link: e.link,
        source: e.source,
      }))
      autoEnrichment.startEventEnrichment(eventsToEnrich)
    } catch (error) {
      console.error('[backfill] Failed to start event enrichment:', error)
    }
  }

  const handleEnrichVenues = async () => {
    try {
      const venues = await getAllPendingVenuesAction()
      const venuesToEnrich: VenueToEnrich[] = venues.map((v) => ({
        venueId: v.id,
        venueName: v.name,
      }))
      autoEnrichment.startVenueEnrichment(venuesToEnrich)
    } catch (error) {
      console.error('[backfill] Failed to start venue enrichment:', error)
    }
  }

  const { state } = autoEnrichment
  const isEnriching = state.phase === 'events' || state.phase === 'venues'
  const isComplete = state.phase === 'complete'
  const hasPending = pendingCounts && (pendingCounts.events > 0 || pendingCounts.venues > 0)

  // Don't show card if nothing pending and not enriching
  if (!isLoadingCounts && !hasPending && !isEnriching && !isComplete) {
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
          {isEnriching && (
            <Button
              variant="ghost"
              size="sm"
              onClick={autoEnrichment.stop}
              className="text-muted-foreground hover:text-foreground"
            >
              <StopCircle className="h-4 w-4 mr-1" />
              Stop
            </Button>
          )}
        </div>
        <CardDescription>
          Enrich events and venues that are missing data
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Pending Counts */}
        {!isEnriching && !isComplete && (
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

        {/* Enrichment Progress */}
        {(isEnriching || isComplete) && (
          <div className="space-y-4">
            {/* Event Progress */}
            {(state.phase === 'events' || state.eventResult) && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Events</span>
                  </span>
                  {state.phase === 'events' && state.eventProgress && (
                    <span className="text-muted-foreground">
                      {state.eventProgress.current}/{state.eventProgress.total}
                    </span>
                  )}
                  {state.eventResult && (
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-green-600 border-green-500/30">
                        {state.eventResult.enriched} enriched
                      </Badge>
                      {state.eventResult.failed > 0 && (
                        <Badge variant="outline" className="text-red-600 border-red-500/30">
                          {state.eventResult.failed} failed
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
                {state.phase === 'events' && state.eventProgress && (
                  <Progress
                    value={(state.eventProgress.current / state.eventProgress.total) * 100}
                    className="h-2"
                  />
                )}
              </div>
            )}

            {/* Venue Progress */}
            {(state.phase === 'venues' || state.venueResult) && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Venues</span>
                  </span>
                  {state.phase === 'venues' && state.venueProgress && (
                    <span className="text-muted-foreground">
                      {state.venueProgress.current}/{state.venueProgress.total}
                    </span>
                  )}
                  {state.venueResult && (
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-green-600 border-green-500/30">
                        {state.venueResult.enriched} enriched
                      </Badge>
                      {state.venueResult.failed > 0 && (
                        <Badge variant="outline" className="text-red-600 border-red-500/30">
                          {state.venueResult.failed} failed
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
                {state.phase === 'venues' && state.venueProgress && (
                  <Progress
                    value={(state.venueProgress.current / state.venueProgress.total) * 100}
                    className="h-2"
                  />
                )}
              </div>
            )}

            {/* Complete Message */}
            {isComplete && (
              <div className="flex items-center gap-2 text-sm text-green-600 pt-2 border-t border-border/30">
                <CheckCircle2 className="h-4 w-4" />
                <span>Enrichment complete</span>
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        {!isEnriching && hasPending && (
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

        {/* Reset after complete */}
        {isComplete && (
          <Button
            variant="outline"
            onClick={() => {
              autoEnrichment.reset()
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
