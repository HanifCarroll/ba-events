import { useEffect, useMemo } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Upload, Check } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { getVenuesForSelect } from '@/features/venues/api/crud'
import { useImportWizard, type WizardStep, type ImportSource } from '@/features/import'
import type { VenueLookupInput } from '@/shared/lib/streaming-types'
import {
  SourceStep,
  ConfigureStep,
  VenuesStep,
  SelectStep,
  ConfirmStep,
  EnrichStep,
  SummaryStep,
  type VenueStats,
  type DataQuality,
} from './-components/import'

const validSources: ImportSource[] = ['passline', 'eventbrite', 'ba-tourism', 'meetup', 'luma', 'csv']

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

  // Helper to extract event ID based on source type
  const getEventId = (event: unknown, source: ImportSource, index: number): string => {
    const e = event as Record<string, unknown>
    switch (source) {
      case 'passline':
        return (e.passline as Record<string, string>)?.id ?? ''
      case 'eventbrite':
        return (e.eventbrite as Record<string, string>)?.url ?? ''
      case 'ba-tourism':
        return `ba-tourism-${(e.baTourism as Record<string, string>)?.name ?? ''}`
      case 'meetup':
        return (e.meetup as Record<string, string>)?.id ?? ''
      case 'luma':
        return (e.luma as Record<string, string>)?.api_id ?? ''
      case 'csv':
        return `csv-${index}`
      default:
        return ''
    }
  }

  // Helper to extract venue name based on source type
  const getVenueName = (event: unknown): string | null => {
    const e = event as Record<string, unknown>
    // Check for transformed data which has venue_name
    if (e.transformed && typeof e.transformed === 'object') {
      const transformed = e.transformed as Record<string, unknown>
      if (typeof transformed.venue_name === 'string') {
        return transformed.venue_name
      }
    }
    return null
  }

  // Helper to extract description based on source type
  const getDescription = (event: unknown): string | null => {
    const e = event as Record<string, unknown>
    // Check for transformed data which has description
    if (e.transformed && typeof e.transformed === 'object') {
      const transformed = e.transformed as Record<string, unknown>
      if (typeof transformed.description === 'string') {
        return transformed.description
      }
    }
    // CSV rows have data.description
    if (e.data && typeof e.data === 'object') {
      const data = e.data as Record<string, unknown>
      if (typeof data.description === 'string') {
        return data.description
      }
    }
    return null
  }

  // Compute venue stats for confirmation step
  const venueStats = useMemo((): VenueStats => {
    const unmatchedCount = wizard.unmatchedVenues.length
    const toCreateCount = wizard.venuesToCreateCount

    // Get events based on source
    const getEventsForSource = (): unknown[] => {
      switch (wizard.source) {
        case 'passline':
          return wizard.passlineEvents
        case 'eventbrite':
          return wizard.eventbriteEvents
        case 'ba-tourism':
          return wizard.baTourismEvents
        case 'meetup':
          return wizard.meetupEvents
        case 'luma':
          return wizard.lumaEvents
        case 'csv':
          return wizard.csvRows
        default:
          return []
      }
    }

    const events = getEventsForSource()
    const selectedEvents = events.filter((e, i) =>
      wizard.selectedIds.has(getEventId(e, wizard.source ?? 'passline', i))
    )
    const venueNames = selectedEvents.map(e => getVenueName(e)).filter((v): v is string => v !== null)
    const uniqueVenues = new Set(venueNames)
    const totalVenues = uniqueVenues.size

    return {
      matched: Math.max(0, totalVenues - unmatchedCount),
      unmatched: unmatchedCount,
      toCreate: toCreateCount,
    }
  }, [
    wizard.source,
    wizard.unmatchedVenues.length,
    wizard.venuesToCreateCount,
    wizard.passlineEvents,
    wizard.eventbriteEvents,
    wizard.baTourismEvents,
    wizard.meetupEvents,
    wizard.lumaEvents,
    wizard.csvRows,
    wizard.selectedIds,
  ])

  // Compute data quality stats for confirmation step
  const dataQuality = useMemo((): DataQuality => {
    const getEventsForSource = (): unknown[] => {
      switch (wizard.source) {
        case 'passline':
          return wizard.passlineEvents
        case 'eventbrite':
          return wizard.eventbriteEvents
        case 'ba-tourism':
          return wizard.baTourismEvents
        case 'meetup':
          return wizard.meetupEvents
        case 'luma':
          return wizard.lumaEvents
        case 'csv':
          // For CSV, only consider valid rows (rows without errors)
          return wizard.csvRows.filter(r => r.errors.length === 0)
        default:
          return []
      }
    }

    const events = getEventsForSource()
    const selectedEvents = events.filter((e, i) =>
      wizard.selectedIds.has(getEventId(e, wizard.source ?? 'passline', i))
    )

    let withDescription = 0
    let withoutDescription = 0

    for (const event of selectedEvents) {
      const desc = getDescription(event)
      if (desc && desc.trim().length > 0) {
        withDescription++
      } else {
        withoutDescription++
      }
    }

    return { withDescription, withoutDescription }
  }, [
    wizard.source,
    wizard.passlineEvents,
    wizard.eventbriteEvents,
    wizard.baTourismEvents,
    wizard.meetupEvents,
    wizard.lumaEvents,
    wizard.csvRows,
    wizard.selectedIds,
  ])

  // Compute event summaries per unmatched venue for VenuesStep
  const venueEventMap = useMemo(() => {
    const map = new Map<string, Array<{ id: string; name: string; link: string | null }>>()

    if (wizard.source === 'passline') {
      for (const event of wizard.passlineEvents) {
        if (event.venueMatch.matchType === 'none') {
          const venueName = event.passline.lugar
          if (!map.has(venueName)) map.set(venueName, [])
          map.get(venueName)!.push({
            id: event.passline.id,
            name: event.passline.nombre,
            link: event.transformed.link ?? null,
          })
        }
      }
    } else if (wizard.source === 'eventbrite') {
      for (const event of wizard.eventbriteEvents) {
        if (event.venueMatch.matchType === 'none') {
          const venueName = event.eventbrite.location?.name || 'Unknown Venue'
          if (!map.has(venueName)) map.set(venueName, [])
          map.get(venueName)!.push({
            id: event.eventbrite.url,
            name: event.eventbrite.name,
            link: event.eventbrite.url,
          })
        }
      }
    } else if (wizard.source === 'ba-tourism') {
      for (const event of wizard.baTourismEvents) {
        if (event.venueMatch.matchType === 'none') {
          const venueName = event.baTourism.venueName
          if (!map.has(venueName)) map.set(venueName, [])
          map.get(venueName)!.push({
            id: `ba-tourism-${event.baTourism.name}`,
            name: event.baTourism.name,
            link: event.baTourism.moreInfoUrl,
          })
        }
      }
    } else if (wizard.source === 'meetup') {
      for (const event of wizard.meetupEvents) {
        if (event.venueMatch.matchType === 'none') {
          const venueName = event.meetup.venue?.name || 'Unknown Venue'
          if (!map.has(venueName)) map.set(venueName, [])
          map.get(venueName)!.push({
            id: event.meetup.id,
            name: event.meetup.name,
            link: event.meetup.eventUrl,
          })
        }
      }
    } else if (wizard.source === 'luma') {
      for (const event of wizard.lumaEvents) {
        if (event.venueMatch.matchType === 'none') {
          const venueName = event.luma.venue?.name || 'Unknown Venue'
          if (!map.has(venueName)) map.set(venueName, [])
          map.get(venueName)!.push({
            id: event.luma.api_id,
            name: event.luma.name,
            link: event.luma.url || null,
          })
        }
      }
    }

    return map
  }, [
    wizard.source,
    wizard.passlineEvents,
    wizard.eventbriteEvents,
    wizard.baTourismEvents,
    wizard.meetupEvents,
    wizard.lumaEvents,
  ])

  // Compute venue lookup data with rich location info for tiered neighborhood lookup
  const venueLookupData = useMemo(() => {
    const map = new Map<string, VenueLookupInput>()

    if (wizard.source === 'ba-tourism') {
      for (const event of wizard.baTourismEvents) {
        if (event.venueMatch.matchType === 'none') {
          const venueName = event.baTourism.venueName
          if (!map.has(venueName)) {
            map.set(venueName, {
              venueName,
              // BA Tourism has direct neighborhood - most reliable!
              neighborhood: event.baTourism.neighborhood || undefined,
              // Also has coordinates as fallback
              coordinates: event.baTourism.coordinates
                ? { lat: event.baTourism.coordinates.lat, lng: event.baTourism.coordinates.lng }
                : undefined,
              address: event.baTourism.address ?? undefined,
            })
          }
        }
      }
    } else if (wizard.source === 'meetup') {
      for (const event of wizard.meetupEvents) {
        if (event.venueMatch.matchType === 'none' && event.meetup.venue) {
          const venueName = event.meetup.venue.name
          if (!map.has(venueName)) {
            map.set(venueName, {
              venueName,
              // Meetup has coordinates - use reverse geocoding
              coordinates:
                event.meetup.venue.lat !== null && event.meetup.venue.lng !== null
                  ? { lat: event.meetup.venue.lat, lng: event.meetup.venue.lng }
                  : undefined,
              address: event.meetup.venue.address ?? undefined,
            })
          }
        }
      }
    } else if (wizard.source === 'luma') {
      for (const event of wizard.lumaEvents) {
        if (event.venueMatch.matchType === 'none' && event.luma.venue?.name) {
          const venueName = event.luma.venue.name
          if (!map.has(venueName)) {
            map.set(venueName, {
              venueName,
              // Luma has coordinates - use reverse geocoding
              coordinates:
                event.luma.venue.latitude !== null && event.luma.venue.longitude !== null
                  ? { lat: event.luma.venue.latitude, lng: event.luma.venue.longitude }
                  : undefined,
              address: event.luma.venue.address ?? undefined,
            })
          }
        }
      }
    } else if (wizard.source === 'eventbrite') {
      for (const event of wizard.eventbriteEvents) {
        if (event.venueMatch.matchType === 'none') {
          const venueName = event.eventbrite.location?.name || 'Unknown Venue'
          if (!map.has(venueName)) {
            // Eventbrite geo coordinates are strings, need to parse them
            const geo = event.eventbrite.location?.geo
            const lat = geo?.latitude ? parseFloat(geo.latitude) : null
            const lng = geo?.longitude ? parseFloat(geo.longitude) : null

            map.set(venueName, {
              venueName,
              coordinates: lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)
                ? { lat, lng }
                : undefined,
            })
          }
        }
      }
    } else if (wizard.source === 'passline') {
      // Passline needs detail page scraping for address - pass event URLs
      for (const event of wizard.passlineEvents) {
        if (event.venueMatch.matchType === 'none') {
          const venueName = event.passline.lugar
          if (!map.has(venueName)) {
            // Include the first event URL for this venue (to scrape address from detail page)
            map.set(venueName, {
              venueName,
              eventUrl: event.transformed.link ?? undefined,
            })
          }
        }
      }
    }

    return map
  }, [
    wizard.source,
    wizard.baTourismEvents,
    wizard.meetupEvents,
    wizard.lumaEvents,
    wizard.eventbriteEvents,
    wizard.passlineEvents,
  ])

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
      if (wizard.source === 'luma') {
        wizard.fetchLumaEventsNeedingEnrichment()
      } else if (wizard.source === 'passline') {
        wizard.fetchPasslineEventsNeedingEnrichment()
      } else {
        wizard.fetchEventsNeedingEnrichment()
      }
    }
  }, [wizard.step, wizard.source, wizard.fetchEventsNeedingEnrichment, wizard.fetchLumaEventsNeedingEnrichment, wizard.fetchPasslineEventsNeedingEnrichment])

  // Determine which steps are visible based on source
  const visibleSteps = STEPS.filter((step) => {
    // Always show source and configure
    if (step.key === 'source' || step.key === 'configure') return true
    // Show venues only when user is on venues step (optional flow)
    if (step.key === 'venues') {
      return wizard.step === 'venues'
    }
    // Show enrich for meetup (venues), luma (descriptions), or passline (descriptions) when on enrich step
    if (step.key === 'enrich') {
      return (wizard.source === 'meetup' || wizard.source === 'luma' || wizard.source === 'passline') && wizard.step === 'enrich'
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
            onFetchLuma={wizard.fetchLumaEvents}
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
                      : wizard.source === 'luma'
                        ? wizard.lumaEvents.length
                        : 0
            }
            venueEventMap={venueEventMap}
            venueLookupData={venueLookupData}
            existingVenues={wizard.venues}
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
            lumaEvents={wizard.lumaEvents}
            csvRows={wizard.csvRows}
            csvValidCount={wizard.csvValidCount}
            csvErrorCount={wizard.csvErrorCount}
            csvAllValid={wizard.csvAllValid}
            selectedIds={wizard.selectedIds}
            unmatchedVenueCount={wizard.unmatchedVenues.length}
            onToggleSelect={wizard.toggleSelect}
            onToggleSelectAll={wizard.toggleSelectAll}
            onProceed={wizard.proceedToConfirm}
            onCreateAllVenues={wizard.unmatchedVenues.length > 0 ? wizard.createAllVenuesAndProceed : undefined}
            onReviewVenues={wizard.unmatchedVenues.length > 0 ? wizard.goToVenues : undefined}
            onSkipVenues={wizard.unmatchedVenues.length > 0 ? wizard.proceedToConfirm : undefined}
            isCreatingVenues={wizard.isCreatingVenues}
          />
        )}

        {wizard.step === 'confirm' && wizard.source && (
          <ConfirmStep
            source={wizard.source}
            selectedCount={wizard.selectedIds.size}
            isImporting={wizard.isImporting}
            importProgress={wizard.importProgress}
            venueStats={venueStats}
            dataQuality={dataQuality}
            onImport={wizard.importEvents}
          />
        )}

        {wizard.step === 'enrich' && (
          <EnrichStep
            enrichmentType={
              wizard.source === 'luma'
                ? 'description'
                : wizard.source === 'passline'
                  ? 'passline-description'
                  : 'venue'
            }
            eventsNeedingEnrichment={
              wizard.source === 'luma'
                ? wizard.lumaEventsNeedingEnrichment.length
                : wizard.source === 'passline'
                  ? wizard.passlineEventsNeedingEnrichment.length
                  : wizard.eventsNeedingEnrichment.length
            }
            isEnriching={wizard.isEnriching}
            enrichmentProgress={wizard.enrichmentProgress}
            enrichmentResult={wizard.enrichmentResult ? {
              enriched: wizard.enrichmentResult.enriched,
              venuesCreated: 'venuesCreated' in wizard.enrichmentResult ? wizard.enrichmentResult.venuesCreated : undefined,
              errors: wizard.enrichmentResult.errors ?? []
            } : null}
            onEnrich={
              wizard.source === 'luma'
                ? wizard.enrichDescriptions
                : wizard.source === 'passline'
                  ? wizard.enrichPasslineDescriptions
                  : wizard.enrichVenues
            }
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
            autoEnrichmentState={wizard.autoEnrichment.state}
            onStopEnrichment={wizard.autoEnrichment.stop}
          />
        )}
      </div>
    </div>
  )
}
