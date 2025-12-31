import { useEffect } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Upload, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getVenuesForSelect } from '@/lib/admin'
import { useImportWizard, type WizardStep, type ImportSource } from '@/hooks'
import {
  SourceStep,
  ConfigureStep,
  VenuesStep,
  SelectStep,
  ConfirmStep,
  EnrichStep,
  SummaryStep,
} from '@/components/admin/import'

const validSources: ImportSource[] = ['passline', 'eventbrite', 'ba-tourism', 'meetup', 'csv']

export const Route = createFileRoute('/admin/events/import')({
  validateSearch: (search: Record<string, unknown>): { source?: ImportSource } => {
    const source = search.source as string | undefined
    if (source && validSources.includes(source as ImportSource)) {
      return { source: source as ImportSource }
    }
    return {}
  },
  loader: async () => {
    return getVenuesForSelect()
  },
  component: ImportEventsPage,
})

const STEPS: { key: WizardStep; label: string }[] = [
  { key: 'source', label: 'Source' },
  { key: 'configure', label: 'Configure' },
  { key: 'venues', label: 'Venues' },
  { key: 'select', label: 'Select' },
  { key: 'confirm', label: 'Import' },
  { key: 'enrich', label: 'Enrich' },
  { key: 'summary', label: 'Complete' },
]

function ImportEventsPage() {
  const venues = Route.useLoaderData()
  const { source: urlSource } = Route.useSearch()
  const navigate = useNavigate()

  const wizard = useImportWizard(venues, urlSource)

  // Sync URL when source changes
  useEffect(() => {
    if (wizard.source && wizard.source !== urlSource) {
      navigate({
        to: '/admin/events/import',
        search: { source: wizard.source },
        replace: true,
      })
    } else if (!wizard.source && urlSource) {
      // Clear URL if source is reset
      navigate({
        to: '/admin/events/import',
        search: {},
        replace: true,
      })
    }
  }, [wizard.source, urlSource, navigate])

  // Fetch events needing enrichment when entering enrich step
  useEffect(() => {
    if (wizard.step === 'enrich') {
      wizard.fetchEventsNeedingEnrichment()
    }
  }, [wizard.step, wizard.fetchEventsNeedingEnrichment])

  // Determine which steps are visible based on source
  const visibleSteps = STEPS.filter((step) => {
    // Always show source and configure
    if (step.key === 'source' || step.key === 'configure') return true
    // Show venues only when user is on venues step (optional flow)
    if (step.key === 'venues') {
      return wizard.step === 'venues'
    }
    // Show enrich only for meetup and only when on enrich step
    if (step.key === 'enrich') {
      return wizard.source === 'meetup' && wizard.step === 'enrich'
    }
    // Show summary only when on summary step
    if (step.key === 'summary') {
      return wizard.step === 'summary'
    }
    // Show select and confirm for all sources
    return true
  })

  const currentStepIndex = visibleSteps.findIndex((s) => s.key === wizard.step)

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center gap-4">
        {wizard.step === 'source' ? (
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
          >
            <Link to="/admin/events">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            onClick={wizard.goBack}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
        )}
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground flex items-center gap-2">
            <Upload className="h-6 w-6 text-primary" />
            Import Events
          </h1>
          <p className="text-muted-foreground mt-1">
            Import events from multiple sources
          </p>
        </div>
      </div>

      <div className="deco-line w-24" />

      {/* Progress Steps */}
      {wizard.step !== 'source' && (
        <div className="flex items-center justify-center gap-2">
          {visibleSteps.map((step, index) => {
            const isActive = step.key === wizard.step
            const isCompleted = index < currentStepIndex
            const isFirst = index === 0

            return (
              <div key={step.key} className="flex items-center">
                {!isFirst && (
                  <div
                    className={`w-8 h-0.5 ${
                      isCompleted ? 'bg-primary' : 'bg-border/50'
                    }`}
                  />
                )}
                <div
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-colors ${
                    isActive
                      ? 'bg-primary/20 text-primary font-medium'
                      : isCompleted
                        ? 'bg-primary/10 text-primary'
                        : 'bg-card/50 text-muted-foreground'
                  }`}
                >
                  {isCompleted ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <span className="h-3.5 w-3.5 flex items-center justify-center text-xs">
                      {index + 1}
                    </span>
                  )}
                  <span className="hidden sm:inline">{step.label}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Error display */}
      {wizard.error && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4">
          <p className="font-medium text-destructive">{wizard.error}</p>
        </div>
      )}

      {/* Step Content */}
      <div className="py-4">
        {wizard.step === 'source' && (
          <SourceStep onSelectSource={wizard.selectSource} />
        )}

        {wizard.step === 'configure' && wizard.source && (
          <ConfigureStep
            source={wizard.source}
            startDate={wizard.startDate}
            endDate={wizard.endDate}
            csvFileName={wizard.csvFileName}
            isFetching={wizard.isFetching}
            meetupFetchProgress={wizard.meetupFetchProgress}
            onStartDateChange={wizard.setStartDate}
            onEndDateChange={wizard.setEndDate}
            onFetchPassline={wizard.fetchPasslineEvents}
            onFetchEventbrite={wizard.fetchEventbriteEvents}
            onFetchBaTourism={wizard.fetchBaTourismEvents}
            onFetchMeetup={wizard.fetchMeetupEvents}
            onCSVFile={wizard.handleCSVFile}
            onClearCSV={wizard.reset}
          />
        )}

        {wizard.step === 'venues' && (
          <VenuesStep
            unmatchedVenues={wizard.unmatchedVenues}
            venueEdits={wizard.venueEdits}
            similarVenues={wizard.similarVenues}
            venuesToCreateCount={wizard.venuesToCreateCount}
            isCreatingVenues={wizard.isCreatingVenues}
            totalEventsCount={
              wizard.source === 'passline'
                ? wizard.passlineEvents.length
                : wizard.source === 'eventbrite'
                  ? wizard.eventbriteEvents.length
                  : wizard.source === 'ba-tourism'
                    ? wizard.baTourismEvents.length
                    : wizard.source === 'meetup'
                      ? wizard.meetupEvents.length
                      : 0
            }
            onUpdateVenueEdit={wizard.updateVenueEdit}
            onCreateVenues={wizard.createVenuesAndProceed}
            onSkip={wizard.skipVenues}
          />
        )}

        {wizard.step === 'select' && wizard.source && (
          <SelectStep
            source={wizard.source}
            passlineEvents={wizard.passlineEvents}
            eventbriteEvents={wizard.eventbriteEvents}
            baTourismEvents={wizard.baTourismEvents}
            meetupEvents={wizard.meetupEvents}
            csvRows={wizard.csvRows}
            csvValidCount={wizard.csvValidCount}
            csvErrorCount={wizard.csvErrorCount}
            csvAllValid={wizard.csvAllValid}
            selectedIds={wizard.selectedIds}
            unmatchedVenueCount={wizard.unmatchedVenues.length}
            onToggleSelect={wizard.toggleSelect}
            onToggleSelectAll={wizard.toggleSelectAll}
            onProceed={wizard.proceedToConfirm}
            onHandleVenues={wizard.unmatchedVenues.length > 0 ? wizard.goToVenues : undefined}
          />
        )}

        {wizard.step === 'confirm' && wizard.source && (
          <ConfirmStep
            source={wizard.source}
            selectedCount={wizard.selectedIds.size}
            isImporting={wizard.isImporting}
            importProgress={wizard.importProgress}
            onImport={wizard.importEvents}
          />
        )}

        {wizard.step === 'enrich' && (
          <EnrichStep
            eventsNeedingEnrichment={wizard.eventsNeedingEnrichment.length}
            isEnriching={wizard.isEnriching}
            enrichmentProgress={wizard.enrichmentProgress}
            enrichmentResult={wizard.enrichmentResult}
            onEnrich={wizard.enrichVenues}
            onSkip={wizard.skipEnrichment}
            onRetryFailed={wizard.retryFailedEnrichment}
            onViewEvents={wizard.viewEvents}
          />
        )}

        {wizard.step === 'summary' && wizard.source && wizard.importResult && (
          <SummaryStep
            source={wizard.source}
            importResult={wizard.importResult}
            autoEnrich={wizard.autoEnrich}
            onAutoEnrichChange={wizard.setAutoEnrich}
            onEnrichNow={() => {
              // TODO: Navigate to events page with enrichment
            }}
            onImportMore={wizard.reset}
          />
        )}
      </div>
    </div>
  )
}
