import { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getDuplicateVenueCandidatesAction,
  detectAddressLikeNamesAction,
  mergeVenuesAction,
  getVenueEventCountsAction,
  getVenueEventsAction,
  updateVenueAction,
} from '@/lib/admin'
import type { VenueEventPreview } from '@/lib/admin/venue-review'
import { queryKeys } from '@/lib/query'
import type { Venue } from '@/lib/types'

export type ReviewTab = 'all' | 'duplicates' | 'address_names'

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

export function useVenueReview(venues: Venue[]) {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<ReviewTab>('all')
  const [selectedDuplicateGroup, setSelectedDuplicateGroup] = useState<DuplicateGroup | null>(null)
  const [selectedAddressVenue, setSelectedAddressVenue] = useState<{
    venue: Venue
    suggestedName?: string
  } | null>(null)
  const [addressAnalysisEnabled, setAddressAnalysisEnabled] = useState(false)

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

  // Fetch address-like names (manually triggered)
  const {
    data: addressResults,
    isLoading: isLoadingAddresses,
    refetch: refetchAddresses,
  } = useQuery({
    queryKey: ['venue-address-names', venues.map((v) => v.id).join(',')],
    queryFn: () =>
      detectAddressLikeNamesAction({
        data: venues.map((v) => ({ id: v.id, name: v.name })),
      }),
    enabled: addressAnalysisEnabled && venues.length > 0,
    staleTime: 10 * 60 * 1000, // 10 minutes (AI analysis)
  })

  // Function to start address analysis
  const startAddressAnalysis = useCallback(() => {
    setAddressAnalysisEnabled(true)
  }, [])

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

      // Use venue with more events as primary, or alphabetically first
      const count1 = eventCounts?.[pair.venue_id] ?? 0
      const count2 = eventCounts?.[pair.similar_venue_id] ?? 0
      const [primary, secondary] =
        count1 > count2 ? [venue1, venue2] : count2 > count1 ? [venue2, venue1] : venue1.name < venue2.name ? [venue1, venue2] : [venue2, venue1]

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
  }, [duplicatePairs, venues, eventCounts])

  // Filter venues with address-like names
  const addressLikeVenues = useMemo((): AddressLikeVenue[] => {
    if (!addressResults) return []

    const venueMap = new Map(venues.map((v) => [v.id, v]))
    return addressResults
      .filter((r) => r.is_address_like && r.confidence > 0.7)
      .map((r) => ({
        venue: venueMap.get(r.venue_id)!,
        confidence: r.confidence,
        suggestedName: r.suggested_name,
      }))
      .filter((r) => r.venue) // Filter out missing venues
      .sort((a, b) => b.confidence - a.confidence)
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

  // Counts for badges
  const duplicateCount = duplicateGroups.length
  const addressNameCount = addressLikeVenues.length

  return {
    // State
    activeTab,
    setActiveTab,
    selectedDuplicateGroup,
    selectedAddressVenue,

    // Data
    duplicateGroups,
    addressLikeVenues,
    eventCounts: eventCounts ?? {},
    addressVenueEvents: addressVenueEvents ?? {} as Record<string, VenueEventPreview[]>,

    // Counts
    duplicateCount,
    addressNameCount,

    // Loading states
    isLoading: isLoadingDuplicates || isLoadingAddresses,
    isLoadingDuplicates,
    isLoadingAddressNames: isLoadingAddresses,

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
  }
}

export type UseVenueReviewReturn = ReturnType<typeof useVenueReview>
