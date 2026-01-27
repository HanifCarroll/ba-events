import { useState, useMemo, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  getDuplicateVenueCandidatesAction,
  detectAddressLikeNamesAction,
  mergeVenuesAction,
  getVenueEventCountsAction,
  getVenueEventsAction,
  dismissDuplicatePairAction,
  getDismissedDuplicatesAction,
  restoreDismissedPairAction,
  getVenuesForAddressCheckAction,
  updateAddressCheckStatusAction,
  markVenueAsConfirmedAction,
  type VenueEventPreview,
  type AddressNameResult,
  type AddressDetectionComplete,
} from '../api/review'
import { updateVenueAction } from '../api/crud'
import { queryKeys } from '@/shared/lib/query'
import type { Venue } from '@/shared/lib/types'

export type ReviewTab = 'all' | 'missing_neighborhood' | 'duplicates' | 'address_names'

export interface DuplicateGroup {
  primaryVenue: Venue
  duplicates: Array<{
    venue: Venue
    similarity: number
  }>
}

export interface AddressLikeVenue {
  venue: Venue
  confidence: number
  suggestedName?: string
}

export interface UseVenueReviewOptions {
  venues: Venue[]
  activeTab: ReviewTab
  setActiveTab: (tab: ReviewTab) => void
}

export function useVenueReview({ venues, activeTab, setActiveTab }: UseVenueReviewOptions) {
  const queryClient = useQueryClient()
  const [selectedDuplicateGroup, setSelectedDuplicateGroup] = useState<DuplicateGroup | null>(null)
  const [selectedAddressVenue, setSelectedAddressVenue] = useState<{
    venue: Venue
    suggestedName?: string
  } | null>(null)
  const [addressAnalysisEnabled, setAddressAnalysisEnabled] = useState(false)
  const [showDismissedDialog, setShowDismissedDialog] = useState(false)

  // Address analysis state (streaming)
  const [addressResults, setAddressResults] = useState<AddressNameResult[] | null>(null)
  const [isLoadingAddresses, setIsLoadingAddresses] = useState(false)
  const [addressProgress, setAddressProgress] = useState<{ current: number; total: number } | null>(null)
  const toastIdRef = useRef<string | number | undefined>(undefined)

  // Fetch duplicate candidates
  const {
    data: duplicatePairs,
    isLoading: isLoadingDuplicates,
    refetch: refetchDuplicates,
  } = useQuery({
    queryKey: ['venue-duplicates'],
    queryFn: () => getDuplicateVenueCandidatesAction({ data: 0.5 }),
    staleTime: 5 * 60 * 1000, // 5 minutes
  })

  // Function to start address analysis with streaming
  // Only analyzes venues with address_check_status = 'pending'
  const startAddressAnalysis = useCallback(async () => {
    setAddressAnalysisEnabled(true)
    setIsLoadingAddresses(true)

    toastIdRef.current = toast.loading('Fetching venues to analyze...')

    try {
      // Fetch only venues that haven't been checked yet
      const pendingVenues = await getVenuesForAddressCheckAction()

      if (pendingVenues.length === 0) {
        toast.success('All venues have already been analyzed', { id: toastIdRef.current })
        setAddressResults([])
        setIsLoadingAddresses(false)
        return
      }

      setAddressProgress({ current: 0, total: pendingVenues.length })
      toast.loading(`Analyzing 0/${pendingVenues.length} venue names...`, { id: toastIdRef.current })

      const stream = await detectAddressLikeNamesAction({
        data: pendingVenues,
      })

      let finalResult: AddressDetectionComplete | null = null

      for await (const update of stream) {
        if (update.type === 'progress') {
          setAddressProgress({ current: update.current, total: update.total })
          toast.loading(
            `Analyzing batch ${update.batchNumber}/${update.totalBatches} (${update.current}/${update.total} venues)`,
            { id: toastIdRef.current }
          )
        } else if (update.type === 'complete') {
          finalResult = update
        }
      }

      if (finalResult) {
        // Persist results to database
        const updates = finalResult.results.map((r) => ({
          id: r.venue_id,
          status: (r.is_address_like && r.confidence > 0.7 ? 'flagged' : 'not_flagged') as 'flagged' | 'not_flagged',
        }))

        if (updates.length > 0) {
          await updateAddressCheckStatusAction({ data: { updates } })
        }

        setAddressResults(finalResult.results)
        const addressLikeCount = finalResult.results.filter(r => r.is_address_like && r.confidence > 0.7).length
        toast.success(
          `Found ${addressLikeCount} address-like venue names (results saved)`,
          { id: toastIdRef.current }
        )

        // Invalidate venues query to refresh the list
        queryClient.invalidateQueries({ queryKey: queryKeys.venues.all })
      }
    } catch (error) {
      console.error('Address analysis failed:', error)
      toast.error('Failed to analyze venue names', {
        id: toastIdRef.current,
        description: error instanceof Error ? error.message : 'An unexpected error occurred.',
      })
    } finally {
      setIsLoadingAddresses(false)
      setAddressProgress(null)
      toastIdRef.current = undefined
    }
  }, [queryClient])

  // Function to re-run address analysis
  const refetchAddresses = useCallback(() => {
    setAddressResults(null)
    startAddressAnalysis()
  }, [startAddressAnalysis])

  // Get IDs of venues that have issues (for fetching event counts)
  const venueIdsWithIssues = useMemo(() => {
    const ids = new Set<string>()
    duplicatePairs?.forEach((p) => {
      ids.add(p.venue_id)
      ids.add(p.similar_venue_id)
    })
    addressResults
      ?.filter((r) => r.is_address_like && r.confidence > 0.7)
      .forEach((r) => ids.add(r.venue_id))
    return Array.from(ids)
  }, [duplicatePairs, addressResults])

  // Fetch event counts for venues with issues
  const { data: eventCounts } = useQuery({
    queryKey: ['venue-event-counts', venueIdsWithIssues.join(',')],
    queryFn: () => getVenueEventCountsAction({ data: venueIdsWithIssues }),
    enabled: venueIdsWithIssues.length > 0,
    staleTime: 2 * 60 * 1000, // 2 minutes
  })

  // IDs of address-like venues (for fetching their events)
  const addressLikeVenueIds = useMemo(() => {
    if (!addressResults) return []
    return addressResults
      .filter((r) => r.is_address_like && r.confidence > 0.7)
      .map((r) => r.venue_id)
  }, [addressResults])

  // Fetch events for address-like venues
  const { data: addressVenueEvents } = useQuery({
    queryKey: ['venue-events-for-address', addressLikeVenueIds.join(',')],
    queryFn: () => getVenueEventsAction({ data: addressLikeVenueIds }),
    enabled: addressLikeVenueIds.length > 0,
    staleTime: 2 * 60 * 1000,
  })

  // Fetch dismissed duplicates (only when dialog is open)
  const {
    data: dismissedDuplicates,
    isLoading: isLoadingDismissed,
  } = useQuery({
    queryKey: ['dismissed-venue-duplicates'],
    queryFn: () => getDismissedDuplicatesAction(),
    enabled: showDismissedDialog,
    staleTime: 2 * 60 * 1000,
  })

  // Group duplicate pairs by primary venue
  const duplicateGroups = useMemo((): DuplicateGroup[] => {
    if (!duplicatePairs || duplicatePairs.length === 0) return []

    const venueMap = new Map(venues.map((v) => [v.id, v]))
    const groups = new Map<string, DuplicateGroup>()
    const processedPairs = new Set<string>()

    for (const pair of duplicatePairs) {
      const pairKey = [pair.venue_id, pair.similar_venue_id].sort().join('-')
      if (processedPairs.has(pairKey)) continue
      processedPairs.add(pairKey)

      const venue1 = venueMap.get(pair.venue_id)
      const venue2 = venueMap.get(pair.similar_venue_id)
      if (!venue1 || !venue2) continue

      // Skip pairs that share the same parent_id - they are intentionally related
      // (e.g., "Cuervo Cafe - Palermo" and "Cuervo Cafe - San Telmo" both under "Cuervo Cafe")
      if (venue1.parent_id && venue2.parent_id && venue1.parent_id === venue2.parent_id) {
        continue
      }

      // Use deterministic ordering: alphabetically first name is primary
      // (Don't use eventCounts here - it causes unstable re-renders as counts load)
      const [primary, secondary] =
        venue1.name.localeCompare(venue2.name) <= 0 ? [venue1, venue2] : [venue2, venue1]

      const existing = groups.get(primary.id)
      if (existing) {
        // Add to existing group if not already there
        if (!existing.duplicates.some((d) => d.venue.id === secondary.id)) {
          existing.duplicates.push({
            venue: secondary,
            similarity: pair.similarity_score,
          })
        }
      } else {
        groups.set(primary.id, {
          primaryVenue: primary,
          duplicates: [
            {
              venue: secondary,
              similarity: pair.similarity_score,
            },
          ],
        })
      }
    }

    return Array.from(groups.values()).sort((a, b) => a.primaryVenue.name.localeCompare(b.primaryVenue.name))
  }, [duplicatePairs, venues])

  // Filter venues with address-like names
  // Shows venues that are flagged OR from current analysis results
  const addressLikeVenues = useMemo((): AddressLikeVenue[] => {
    // First, get venues already flagged in the database
    const flaggedVenues = venues
      .filter((v) => v.address_check_status === 'flagged')
      .map((v) => {
        // Try to find confidence from current results if available
        const result = addressResults?.find((r) => r.venue_id === v.id)
        return {
          venue: v,
          confidence: result?.confidence ?? 0.8, // Default confidence for already-flagged venues
          suggestedName: result?.suggested_name,
        }
      })

    // If we have fresh results, also include newly detected ones
    if (addressResults) {
      const venueMap = new Map(venues.map((v) => [v.id, v]))
      const fromResults = addressResults
        .filter((r) => r.is_address_like && r.confidence > 0.7)
        .map((r) => ({
          venue: venueMap.get(r.venue_id)!,
          confidence: r.confidence,
          suggestedName: r.suggested_name,
        }))
        .filter((r) => r.venue)

      // Merge, preferring results with higher confidence
      const merged = new Map<string, AddressLikeVenue>()
      for (const v of flaggedVenues) {
        merged.set(v.venue.id, v)
      }
      for (const v of fromResults) {
        const existing = merged.get(v.venue.id)
        if (!existing || v.confidence > existing.confidence) {
          merged.set(v.venue.id, v)
        }
      }

      return Array.from(merged.values()).sort((a, b) => b.confidence - a.confidence)
    }

    return flaggedVenues.sort((a, b) => b.confidence - a.confidence)
  }, [addressResults, venues])

  // Merge mutation
  const mergeMutation = useMutation({
    mutationFn: (input: { sourceVenueId: string; targetVenueId: string }) => mergeVenuesAction({ data: input }),
    onSuccess: () => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: queryKeys.venues.all })
      queryClient.invalidateQueries({ queryKey: ['venue-duplicates'] })
      queryClient.invalidateQueries({ queryKey: ['venue-event-counts'] })
      setSelectedDuplicateGroup(null)
    },
  })

  // Rename mutation (uses existing updateVenueAction)
  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateVenueAction({ data: { id, data: { name } } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.venues.all })
      queryClient.invalidateQueries({ queryKey: ['venue-address-names'] })
      setSelectedAddressVenue(null)
    },
  })

  // Dismiss duplicate pair mutation with optimistic update
  const dismissMutation = useMutation({
    mutationFn: (input: { venueId1: string; venueId2: string }) =>
      dismissDuplicatePairAction({ data: input }),
    onMutate: async (variables) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ['venue-duplicates'] })

      // Snapshot the previous value
      const previousPairs = queryClient.getQueryData<typeof duplicatePairs>(['venue-duplicates'])

      // Optimistically remove the dismissed pair from the cache
      queryClient.setQueryData<typeof duplicatePairs>(['venue-duplicates'], (old) => {
        if (!old) return old
        return old.filter((pair) => {
          // Filter out pairs that match either direction
          const matches =
            (pair.venue_id === variables.venueId1 && pair.similar_venue_id === variables.venueId2) ||
            (pair.venue_id === variables.venueId2 && pair.similar_venue_id === variables.venueId1)
          return !matches
        })
      })

      // Return context with the previous value for rollback
      return { previousPairs }
    },
    onError: (_err, _variables, context) => {
      // Rollback to the previous value on error
      if (context?.previousPairs) {
        queryClient.setQueryData(['venue-duplicates'], context.previousPairs)
      }
    },
    onSettled: () => {
      // Always refetch after error or success to ensure server state
      queryClient.invalidateQueries({ queryKey: ['venue-duplicates'] })
      queryClient.invalidateQueries({ queryKey: ['dismissed-venue-duplicates'] })
    },
  })

  // Restore dismissed pair mutation
  const restoreMutation = useMutation({
    mutationFn: (id: string) => restoreDismissedPairAction({ data: id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['venue-duplicates'] })
      queryClient.invalidateQueries({ queryKey: ['dismissed-venue-duplicates'] })
    },
  })

  // Mark venue as confirmed (not an address) mutation
  const confirmVenueMutation = useMutation({
    mutationFn: (venueId: string) => markVenueAsConfirmedAction({ data: venueId }),
    onMutate: async (venueId) => {
      // Optimistically remove from address results
      setAddressResults((prev) =>
        prev ? prev.filter((r) => r.venue_id !== venueId) : prev
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.venues.all })
      toast.success('Venue marked as confirmed')
    },
    onError: (error) => {
      toast.error('Failed to confirm venue', {
        description: error instanceof Error ? error.message : 'An unexpected error occurred.',
      })
    },
  })

  // Dialog helpers
  const openMergeDialog = useCallback((group: DuplicateGroup) => {
    setSelectedDuplicateGroup(group)
  }, [])

  const closeMergeDialog = useCallback(() => {
    setSelectedDuplicateGroup(null)
  }, [])

  const openRenameDialog = useCallback((venue: Venue, suggestedName?: string) => {
    setSelectedAddressVenue({ venue, suggestedName })
  }, [])

  const closeRenameDialog = useCallback(() => {
    setSelectedAddressVenue(null)
  }, [])

  const handleMerge = useCallback(
    (sourceId: string, targetId: string) => {
      mergeMutation.mutate({ sourceVenueId: sourceId, targetVenueId: targetId })
    },
    [mergeMutation]
  )

  const handleRename = useCallback(
    (name: string) => {
      if (!selectedAddressVenue) return
      renameMutation.mutate({ id: selectedAddressVenue.venue.id, name })
    },
    [selectedAddressVenue, renameMutation]
  )

  const handleDismiss = useCallback(
    (venueId1: string, venueId2: string) => {
      dismissMutation.mutate({ venueId1, venueId2 })
    },
    [dismissMutation]
  )

  const handleRestore = useCallback(
    (id: string) => {
      restoreMutation.mutate(id)
    },
    [restoreMutation]
  )

  const handleConfirmVenue = useCallback(
    (venueId: string) => {
      confirmVenueMutation.mutate(venueId)
    },
    [confirmVenueMutation]
  )

  // Counts for badges
  const duplicateCount = duplicateGroups.length
  const addressNameCount = addressLikeVenues.length
  const dismissedCount = dismissedDuplicates?.length ?? 0
  const missingNeighborhoodCount = useMemo(
    () => venues.filter((v) => !v.neighborhood).length,
    [venues]
  )
  const missingNeighborhoodVenues = useMemo(
    () => venues.filter((v) => !v.neighborhood),
    [venues]
  )

  return {
    // State
    activeTab,
    setActiveTab,
    selectedDuplicateGroup,
    selectedAddressVenue,

    // Data
    duplicateGroups,
    addressLikeVenues,
    missingNeighborhoodVenues,
    eventCounts: eventCounts ?? {},
    addressVenueEvents: addressVenueEvents ?? {} as Record<string, VenueEventPreview[]>,

    // Counts
    duplicateCount,
    addressNameCount,
    dismissedCount,
    missingNeighborhoodCount,

    // Loading states
    isLoading: isLoadingDuplicates || isLoadingAddresses,
    isLoadingDuplicates,
    isLoadingAddressNames: isLoadingAddresses,
    isLoadingDismissed,
    addressProgress,

    // Actions
    refetchDuplicates,
    startAddressAnalysis,
    refetchAddressNames: refetchAddresses,
    hasStartedAddressAnalysis: addressAnalysisEnabled,
    openMergeDialog,
    closeMergeDialog,
    openRenameDialog,
    closeRenameDialog,
    handleMerge,
    handleRename,
    isMerging: mergeMutation.isPending,
    mergeError: mergeMutation.error,
    isRenaming: renameMutation.isPending,
    renameError: renameMutation.error,

    // Dismissed duplicates
    dismissedDuplicates: dismissedDuplicates ?? [],
    showDismissedDialog,
    setShowDismissedDialog,
    handleDismiss,
    handleRestore,
    isDismissing: dismissMutation.isPending,
    isRestoring: restoreMutation.isPending,

    // Confirm venue (not an address)
    handleConfirmVenue,
    isConfirmingVenue: confirmVenueMutation.isPending,
  }
}

export type UseVenueReviewReturn = ReturnType<typeof useVenueReview>
