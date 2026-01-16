import { useState, useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { mapToNeighborhood } from '@/shared/lib/admin-utils'
import { useImportSource, type ImportSource } from './useImportSource'
import { useImportPreview } from './useImportPreview'
import { useImportVenues, type VenueEdit } from './useImportVenues'
import { useImportEnrichment } from './useImportEnrichment'
import { useImportSubmit } from './useImportSubmit'

export type { ImportSource } from './useImportSource'
export type WizardStep = 'source' | 'configure' | 'venues' | 'select' | 'confirm' | 'enrich' | 'summary'
export type { ImportResult } from './useImportSubmit'
export type { ParsedCSVRow } from './useImportSource'

/**
 * Main import wizard hook that orchestrates smaller, focused hooks.
 * Each sub-hook manages its own state and logic:
 * - useImportSource: Source selection and fetching
 * - useImportPreview: Event selection and filtering
 * - useImportVenues: Venue matching and creation
 * - useImportEnrichment: Post-import enrichment
 * - useImportSubmit: Final submission
 */
export function useImportWizard(
  initialVenues: { id: string; name: string; neighborhood: string | null }[],
  initialSource?: ImportSource
) {
  // Core wizard step state
  const [step, setStep] = useState<WizardStep>(initialSource ? 'configure' : 'source')
  const [error, setError] = useState<string | null>(null)

  // Compose sub-hooks
  const sourceHook = useImportSource(initialSource)
  const previewHook = useImportPreview()
  const venuesHook = useImportVenues(initialVenues)
  const enrichmentHook = useImportEnrichment(setError)
  const submitHook = useImportSubmit(setError)

  // Compute unmatched venues as a memoized value
  const unmatchedVenues = useMemo(() => {
    return previewHook.computeUnmatchedVenues(
      sourceHook.source,
      sourceHook.passlineEvents,
      sourceHook.eventbriteEvents,
      sourceHook.baTourismEvents,
      sourceHook.meetupEvents,
      sourceHook.lumaEvents
    )
  }, [
    sourceHook.source,
    sourceHook.passlineEvents,
    sourceHook.eventbriteEvents,
    sourceHook.baTourismEvents,
    sourceHook.meetupEvents,
    sourceHook.lumaEvents,
    previewHook.computeUnmatchedVenues,
  ])

  // Wrap source selection to also update step
  const selectSource = useCallback((newSource: ImportSource) => {
    sourceHook.selectSource(newSource)
    setStep('configure')
    setError(null)
  }, [sourceHook])

  // Wrap fetch handlers to update step and selection
  const fetchPasslineEvents = useCallback(async () => {
    try {
      const { venueEdits, selectedIds } = await sourceHook.fetchPasslineEvents()
      venuesHook.setVenueEdits(venueEdits)
      previewHook.setSelectedIds(selectedIds)
      setStep('select')
    } catch {
      // Error already handled in sourceHook
    }
  }, [sourceHook, venuesHook, previewHook])

  const fetchEventbriteEvents = useCallback(async () => {
    try {
      const { venueEdits, selectedIds } = await sourceHook.fetchEventbriteEvents()
      venuesHook.setVenueEdits(venueEdits)
      previewHook.setSelectedIds(selectedIds)
      setStep('select')
    } catch {
      // Error already handled in sourceHook
    }
  }, [sourceHook, venuesHook, previewHook])

  const fetchBaTourismEvents = useCallback(async () => {
    try {
      const result = await sourceHook.fetchBaTourismEvents()
      // Update venue edits with neighborhood mapping
      const edits = new Map<string, VenueEdit>()
      sourceHook.baTourismEvents
        .filter(e => e.venueMatch.matchType === 'none')
        .forEach(e => {
          const name = e.baTourism.venueName
          if (!edits.has(name)) {
            edits.set(name, {
              name,
              neighborhood: mapToNeighborhood(e.baTourism.neighborhood),
              action: 'create',
            })
          }
        })
      venuesHook.setVenueEdits(result.venueEdits)
      previewHook.setSelectedIds(result.selectedIds)
      setStep('select')
    } catch {
      // Error already handled in sourceHook
    }
  }, [sourceHook, venuesHook, previewHook])

  const fetchMeetupEvents = useCallback(async () => {
    try {
      const { venueEdits, selectedIds } = await sourceHook.fetchMeetupEvents()
      venuesHook.setVenueEdits(venueEdits)
      previewHook.setSelectedIds(selectedIds)
      setStep('select')
    } catch {
      // Error already handled in sourceHook
    }
  }, [sourceHook, venuesHook, previewHook])

  const fetchLumaEvents = useCallback(async () => {
    try {
      const { venueEdits, selectedIds } = await sourceHook.fetchLumaEvents()
      venuesHook.setVenueEdits(venueEdits)
      previewHook.setSelectedIds(selectedIds)
      setStep('select')
    } catch {
      // Error already handled in sourceHook
    }
  }, [sourceHook, venuesHook, previewHook])

  const handleCSVFile = useCallback((file: File) => {
    sourceHook.handleCSVFile(file, venuesHook.venueNameToId)
    // After parsing, select valid rows
    const validIds = sourceHook.csvRows
      .filter(r => r.errors.length === 0)
      .map((_, i) => `csv-${i}`)
    previewHook.setSelectedIds(new Set(validIds))
    setStep('select')
  }, [sourceHook, venuesHook.venueNameToId, previewHook])

  // Wrap venue creation to update events and step
  const createVenuesAndProceed = useCallback(async () => {
    setError(null)
    try {
      const result = await venuesHook.createVenuesAndProceed(
        sourceHook.source,
        sourceHook.passlineEvents,
        sourceHook.eventbriteEvents,
        sourceHook.baTourismEvents,
        sourceHook.meetupEvents,
        sourceHook.lumaEvents
      )

      // Update events with new venue matches
      if (result.passlineEvents) sourceHook.setPasslineEvents(result.passlineEvents)
      if (result.eventbriteEvents) sourceHook.setEventbriteEvents(result.eventbriteEvents)
      if (result.baTourismEvents) sourceHook.setBaTourismEvents(result.baTourismEvents)
      if (result.meetupEvents) sourceHook.setMeetupEvents(result.meetupEvents)
      if (result.lumaEvents) sourceHook.setLumaEvents(result.lumaEvents)
      previewHook.setSelectedIds(result.selectedIds)

      setStep('select')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create venues')
      toast.error('Failed to create venues')
    }
  }, [sourceHook, venuesHook, previewHook])

  const createAllVenuesAndProceed = useCallback(async () => {
    setError(null)
    try {
      const result = await venuesHook.createAllVenuesAndProceed(
        sourceHook.source,
        unmatchedVenues,
        sourceHook.passlineEvents,
        sourceHook.eventbriteEvents,
        sourceHook.baTourismEvents,
        sourceHook.meetupEvents,
        sourceHook.lumaEvents
      )

      // Update events with new venue matches
      if (result.passlineEvents) sourceHook.setPasslineEvents(result.passlineEvents)
      if (result.eventbriteEvents) sourceHook.setEventbriteEvents(result.eventbriteEvents)
      if (result.baTourismEvents) sourceHook.setBaTourismEvents(result.baTourismEvents)
      if (result.meetupEvents) sourceHook.setMeetupEvents(result.meetupEvents)
      if (result.lumaEvents) sourceHook.setLumaEvents(result.lumaEvents)

      setStep('confirm')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create venues')
      toast.error('Failed to create venues')
    }
  }, [sourceHook, venuesHook, unmatchedVenues])

  const skipVenues = useCallback(() => {
    previewHook.selectMatchedOnly(
      sourceHook.source,
      sourceHook.passlineEvents,
      sourceHook.eventbriteEvents,
      sourceHook.baTourismEvents,
      sourceHook.meetupEvents,
      sourceHook.lumaEvents
    )
    setStep('select')
  }, [sourceHook, previewHook])

  const toggleSelectAll = useCallback(() => {
    previewHook.toggleSelectAll(
      sourceHook.source,
      sourceHook.passlineEvents,
      sourceHook.eventbriteEvents,
      sourceHook.baTourismEvents,
      sourceHook.meetupEvents,
      sourceHook.lumaEvents,
      sourceHook.csvRows
    )
  }, [sourceHook, previewHook])

  const proceedToConfirm = useCallback(() => {
    setStep('confirm')
  }, [])

  const goToVenues = useCallback(() => {
    if (unmatchedVenues.length > 0) {
      setStep('venues')
    }
  }, [unmatchedVenues.length])

  // Wrap import to handle step transitions
  const importEvents = useCallback(async () => {
    const result = await submitHook.importEvents({
      source: sourceHook.source,
      selectedIds: previewHook.selectedIds,
      passlineEvents: sourceHook.passlineEvents,
      eventbriteEvents: sourceHook.eventbriteEvents,
      baTourismEvents: sourceHook.baTourismEvents,
      baTourismWeekContext: sourceHook.baTourismWeekContext,
      meetupEvents: sourceHook.meetupEvents,
      lumaEvents: sourceHook.lumaEvents,
      csvRows: sourceHook.csvRows,
    })

    if (result) {
      if (result.needsEnrichment) {
        setStep('enrich')
      } else {
        setStep('summary')
      }
    }
  }, [sourceHook, previewHook.selectedIds, submitHook])

  // Wrap enrichment retry
  const retryFailedEnrichment = useCallback(async () => {
    await enrichmentHook.retryFailedEnrichment(sourceHook.source)
  }, [enrichmentHook, sourceHook.source])

  const goBack = useCallback(() => {
    if (step === 'configure') {
      setStep('source')
      sourceHook.selectSource(null as unknown as ImportSource)
    } else if (step === 'venues') {
      setStep('select')
    } else if (step === 'select') {
      setStep('configure')
    } else if (step === 'confirm') {
      setStep('select')
    }
    // Don't allow going back from enrich step
  }, [step, sourceHook])

  const reset = useCallback(() => {
    setStep('source')
    setError(null)
    sourceHook.reset()
    previewHook.reset()
    venuesHook.reset()
    enrichmentHook.reset()
    submitHook.reset()
  }, [sourceHook, previewHook, venuesHook, enrichmentHook, submitHook])

  return {
    // State
    step,
    source: sourceHook.source,
    startDate: sourceHook.startDate,
    endDate: sourceHook.endDate,
    passlineEvents: sourceHook.passlineEvents,
    eventbriteEvents: sourceHook.eventbriteEvents,
    baTourismEvents: sourceHook.baTourismEvents,
    meetupEvents: sourceHook.meetupEvents,
    lumaEvents: sourceHook.lumaEvents,
    csvRows: sourceHook.csvRows,
    csvFileName: sourceHook.csvFileName,
    venues: venuesHook.venues,
    venueEdits: venuesHook.venueEdits,
    unmatchedVenues,
    similarVenues: previewHook.similarVenues,
    selectedIds: previewHook.selectedIds,
    venuesToCreateCount: venuesHook.venuesToCreateCount,
    csvValidCount: sourceHook.csvValidCount,
    csvErrorCount: sourceHook.csvErrorCount,
    csvAllValid: sourceHook.csvAllValid,
    isFetching: sourceHook.isFetching,
    meetupFetchProgress: sourceHook.meetupFetchProgress,
    isCreatingVenues: venuesHook.isCreatingVenues,
    isImporting: submitHook.isImporting,
    importProgress: submitHook.importProgress,
    error: sourceHook.error || error,

    // Enrichment state
    isEnriching: enrichmentHook.isEnriching,
    enrichmentProgress: enrichmentHook.enrichmentProgress,
    enrichmentResult: enrichmentHook.enrichmentResult,
    eventsNeedingEnrichment: enrichmentHook.eventsNeedingEnrichment,
    lumaEventsNeedingEnrichment: enrichmentHook.lumaEventsNeedingEnrichment,
    passlineEventsNeedingEnrichment: enrichmentHook.passlineEventsNeedingEnrichment,
    isLoadingEnrichmentEvents: enrichmentHook.isLoadingEnrichmentEvents,

    // Import result state (for summary step)
    importResult: submitHook.importResult,
    autoEnrich: submitHook.autoEnrich,

    // Auto-enrichment state (for post-import enrichment)
    autoEnrichment: submitHook.autoEnrichment,

    // Actions
    selectSource,
    setStartDate: sourceHook.setStartDate,
    setEndDate: sourceHook.setEndDate,
    fetchPasslineEvents,
    fetchEventbriteEvents,
    fetchBaTourismEvents,
    fetchMeetupEvents,
    fetchLumaEvents,
    handleCSVFile,
    updateVenueEdit: venuesHook.updateVenueEdit,
    createVenuesAndProceed,
    createAllVenuesAndProceed,
    skipVenues,
    toggleSelect: previewHook.toggleSelect,
    toggleSelectAll,
    proceedToConfirm,
    importEvents,
    goToVenues,
    goBack,
    reset,

    // Enrichment actions
    fetchEventsNeedingEnrichment: enrichmentHook.fetchEventsNeedingEnrichment,
    fetchLumaEventsNeedingEnrichment: enrichmentHook.fetchLumaEventsNeedingEnrichment,
    fetchPasslineEventsNeedingEnrichment: enrichmentHook.fetchPasslineEventsNeedingEnrichment,
    enrichVenues: enrichmentHook.enrichVenues,
    enrichDescriptions: enrichmentHook.enrichDescriptions,
    enrichPasslineDescriptions: enrichmentHook.enrichPasslineDescriptions,
    skipEnrichment: enrichmentHook.skipEnrichment,
    retryFailedEnrichment,
    viewEvents: enrichmentHook.viewEvents,

    // Summary step actions
    setAutoEnrich: submitHook.setAutoEnrich,
  }
}

export type UseImportWizardReturn = ReturnType<typeof useImportWizard>
