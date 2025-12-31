import { useState } from 'react'
import { Loader2, MapPin, CheckCircle2, AlertCircle, Users, ChevronDown, ChevronRight, RotateCcw, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

interface EnrichStepProps {
  eventsNeedingEnrichment: number
  isEnriching: boolean
  enrichmentProgress: { current: number; total: number } | null
  enrichmentResult: {
    enriched: number
    venuesCreated: number
    errors: Array<{ id: string; error: string }>
  } | null
  onEnrich: () => void
  onSkip: () => void
  onRetryFailed?: () => void
  onViewEvents?: () => void
}

export function EnrichStep({
  eventsNeedingEnrichment,
  isEnriching,
  enrichmentProgress,
  enrichmentResult,
  onEnrich,
  onSkip,
  onRetryFailed,
  onViewEvents,
}: EnrichStepProps) {
  const hasCompleted = enrichmentResult !== null
  const [errorsOpen, setErrorsOpen] = useState(false)
  const hasErrors = hasCompleted && enrichmentResult.errors.length > 0

  return (
    <div className="space-y-6 max-w-md mx-auto">
      <div className="text-center space-y-2">
        <h2 className="font-display text-xl font-semibold text-foreground">
          Enrich Venue Data
        </h2>
        <p className="text-muted-foreground">
          {hasCompleted
            ? 'Venue enrichment complete'
            : 'Fetch venue information from Meetup event pages'}
        </p>
      </div>

      <div className="bg-card/50 rounded-xl border border-border/50 p-6 space-y-6">
        {/* Source indicator */}
        <div className="flex items-center gap-3 pb-4 border-b border-border/30">
          <div className="h-10 w-10 rounded-lg flex items-center justify-center bg-red-500/10">
            <Users className="h-5 w-5 text-red-500" />
          </div>
          <div>
            <p className="font-medium text-foreground">
              Meetup Venue Enrichment
            </p>
            <p className="text-sm text-muted-foreground">
              {hasCompleted
                ? `${enrichmentResult.enriched} event${enrichmentResult.enriched !== 1 ? 's' : ''} enriched`
                : `${eventsNeedingEnrichment} event${eventsNeedingEnrichment !== 1 ? 's' : ''} without venue data`}
            </p>
          </div>
        </div>

        {/* Results summary */}
        {hasCompleted ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Events enriched</span>
              <span className="font-medium text-foreground flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                {enrichmentResult.enriched}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">New venues created</span>
              <span className="font-medium text-foreground flex items-center gap-1.5">
                <MapPin className="h-4 w-4 text-blue-500" />
                {enrichmentResult.venuesCreated}
              </span>
            </div>
            {hasErrors && (
              <Collapsible open={errorsOpen} onOpenChange={setErrorsOpen}>
                <CollapsibleTrigger asChild>
                  <button className="flex items-center justify-between text-sm w-full hover:bg-muted/50 -mx-2 px-2 py-1 rounded transition-colors">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      {errorsOpen ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                      Failed events
                    </span>
                    <span className="font-medium text-destructive flex items-center gap-1.5">
                      <AlertCircle className="h-4 w-4" />
                      {enrichmentResult.errors.length}
                    </span>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2">
                  <div className="bg-destructive/10 rounded-lg p-3 space-y-2 max-h-48 overflow-y-auto">
                    {enrichmentResult.errors.map((err, i) => (
                      <div key={i} className="text-xs">
                        <code className="text-destructive font-mono">{err.id}</code>
                        <p className="text-muted-foreground mt-0.5">{err.error}</p>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Events to enrich</span>
              <span className="font-medium text-foreground">{eventsNeedingEnrichment}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              This will visit each event's detail page to fetch venue information.
              New venues will be automatically created when found.
            </p>
          </div>
        )}

        {/* Progress bar */}
        {enrichmentProgress && !hasCompleted && (
          <div className="space-y-2">
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-red-500 transition-all duration-300"
                style={{ width: `${(enrichmentProgress.current / enrichmentProgress.total) * 100}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground text-center">
              {enrichmentProgress.current} of {enrichmentProgress.total} events processed
            </p>
          </div>
        )}

        {/* Action buttons */}
        {!hasCompleted && (
          <div className="space-y-2">
            <Button
              onClick={onEnrich}
              disabled={isEnriching || eventsNeedingEnrichment === 0}
              className="w-full bg-red-600 hover:bg-red-700 text-white"
            >
              {isEnriching ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {enrichmentProgress
                    ? `Enriching ${enrichmentProgress.current}/${enrichmentProgress.total}...`
                    : 'Starting enrichment...'}
                </>
              ) : (
                <>
                  <MapPin className="h-4 w-4 mr-2" />
                  Enrich {eventsNeedingEnrichment} Event{eventsNeedingEnrichment !== 1 ? 's' : ''}
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              onClick={onSkip}
              disabled={isEnriching}
              className="w-full text-muted-foreground"
            >
              Skip for now
            </Button>
          </div>
        )}

        {/* Completion actions */}
        {hasCompleted && (
          <div className="space-y-3">
            <div className="flex items-center justify-center gap-2 text-sm text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              <span>Venue enrichment complete</span>
            </div>

            <div className="flex flex-col gap-2">
              {/* Retry failed button - only show if there were errors and retry handler exists */}
              {hasErrors && onRetryFailed && (
                <Button
                  onClick={onRetryFailed}
                  variant="outline"
                  className="w-full border-destructive/50 text-destructive hover:bg-destructive/10"
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Retry {enrichmentResult.errors.length} Failed Event{enrichmentResult.errors.length !== 1 ? 's' : ''}
                </Button>
              )}

              {/* View events button */}
              {onViewEvents && (
                <Button
                  onClick={onViewEvents}
                  className="w-full bg-gold-500 hover:bg-gold-600 text-background"
                >
                  <ArrowRight className="h-4 w-4 mr-2" />
                  View Events
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Info note */}
      {!hasCompleted && !isEnriching && (
        <p className="text-xs text-center text-muted-foreground">
          You can always run enrichment later from the Events admin page
        </p>
      )}
    </div>
  )
}
