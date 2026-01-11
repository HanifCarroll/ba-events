/**
 * Unified Description Enrichment Hook
 *
 * Orchestrates the three description enrichment strategies (Background, Passline, Luma)
 * into a single interface. Automatically routes events to the correct enrichment method
 * based on their source.
 *
 * Execution order: Passline → Luma → Background
 * (Source-specific methods first, then generic fallback)
 */

import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useInvalidateCache } from '@/shared/hooks/useInvalidateCache'
import type { EventWithVenue } from '@/shared/lib/types'
import type { UseBackgroundEnrichmentReturn } from './useBackgroundEnrichment'
import type { UsePasslineDescriptionEnrichmentReturn } from './usePasslineDescriptionEnrichment'
import type { UseLumaDescriptionEnrichmentReturn } from './useLumaDescriptionEnrichment'
import type { DescriptionEnrichmentMethod } from './description-enrichment-strategies'

// Execution order for enrichment methods
// Source-specific methods first (more efficient), then generic fallback
const EXECUTION_ORDER: DescriptionEnrichmentMethod[] = ['passline', 'luma', 'background']

interface EnrichmentProgress {
  isEnriching: boolean
  current: number
  total: number
  currentMethod: DescriptionEnrichmentMethod | null
}

export function useUnifiedDescriptionEnrichment(
  backgroundEnrichment: UseBackgroundEnrichmentReturn,
  passlineEnrichment: UsePasslineDescriptionEnrichmentReturn,
  lumaEnrichment: UseLumaDescriptionEnrichmentReturn
) {
  const { invalidateEvents } = useInvalidateCache()

  // Track unified state
  const [isEnriching, setIsEnriching] = useState(false)
  const [currentMethod, setCurrentMethod] = useState<DescriptionEnrichmentMethod | null>(null)
  const shouldStopRef = useRef(false)
  const totalProcessedRef = useRef(0)
  const totalToProcessRef = useRef(0)

  /**
   * Get events enrichable by each method using the hooks' own filter functions.
   * This respects each hook's enrichment eligibility logic.
   */
  const getEnrichableEventsByMethod = useCallback(
    (events: EventWithVenue[], selectedIds: Set<string>) => {
      const result = new Map<DescriptionEnrichmentMethod, EventWithVenue[]>()

      // Use each hook's own filter function to determine eligibility
      // This respects source-specific enrichment_status checks

      // Passline events
      const passlineEvents = passlineEnrichment.getPasslineEnrichableEvents(events, selectedIds)
      result.set('passline', passlineEvents)

      // Luma events
      const lumaEvents = lumaEnrichment.getLumaEnrichableEvents(events, selectedIds)
      result.set('luma', lumaEvents)

      // Background enrichment - for events not handled by source-specific methods
      // Filter out events that are handled by passline or luma
      const passlineIds = new Set(passlineEvents.map((e) => e.id))
      const lumaIds = new Set(lumaEvents.map((e) => e.id))

      const backgroundCandidates = events.filter(
        (e) => selectedIds.has(e.id) && !passlineIds.has(e.id) && !lumaIds.has(e.id)
      )
      const backgroundEvents = backgroundEnrichment.getEnrichableEvents(
        backgroundCandidates,
        new Set(backgroundCandidates.map((e) => e.id))
      )
      result.set('background', backgroundEvents)

      return result
    },
    [
      backgroundEnrichment,
      passlineEnrichment,
      lumaEnrichment,
    ]
  )

  /**
   * Get total count of enrichable events across all methods.
   */
  const getEnrichableCount = useCallback(
    (events: EventWithVenue[], selectedIds: Set<string>): number => {
      const byMethod = getEnrichableEventsByMethod(events, selectedIds)
      let total = 0
      for (const eventList of byMethod.values()) {
        total += eventList.length
      }
      return total
    },
    [getEnrichableEventsByMethod]
  )

  /**
   * Get counts broken down by enrichment method.
   */
  const getEnrichableCountByMethod = useCallback(
    (
      events: EventWithVenue[],
      selectedIds: Set<string>
    ): Map<DescriptionEnrichmentMethod, number> => {
      const byMethod = getEnrichableEventsByMethod(events, selectedIds)
      const counts = new Map<DescriptionEnrichmentMethod, number>()
      for (const [method, eventList] of byMethod) {
        counts.set(method, eventList.length)
      }
      return counts
    },
    [getEnrichableEventsByMethod]
  )

  /**
   * Execute enrichment for a specific method.
   * Returns a promise that resolves when enrichment completes or is stopped.
   */
  const executeMethodEnrichment = useCallback(
    async (
      method: DescriptionEnrichmentMethod,
      events: EventWithVenue[],
      selectedIds: Set<string>
    ): Promise<boolean> => {
      // Check if we should stop before starting this method
      if (shouldStopRef.current) {
        return false
      }

      setCurrentMethod(method)

      return new Promise((resolve) => {
        const onComplete = () => {
          resolve(true)
        }

        switch (method) {
          case 'passline':
            passlineEnrichment.enrichPasslineEvents(events, selectedIds, onComplete)
            break
          case 'luma':
            lumaEnrichment.enrichLumaEvents(events, selectedIds, onComplete)
            break
          case 'background':
            backgroundEnrichment.enrichEvents(events, selectedIds, onComplete)
            break
          default:
            resolve(true)
        }
      })
    },
    [backgroundEnrichment, passlineEnrichment, lumaEnrichment]
  )

  /**
   * Unified enrichment function that processes all selected events.
   * Routes each event to the appropriate enrichment method based on source.
   */
  const enrichDescriptions = useCallback(
    async (
      events: EventWithVenue[],
      selectedIds: Set<string>,
      onComplete?: () => void
    ) => {
      const byMethod = getEnrichableEventsByMethod(events, selectedIds)

      // Calculate total
      let total = 0
      for (const eventList of byMethod.values()) {
        total += eventList.length
      }

      if (total === 0) {
        toast.info('No events need descriptions', {
          description:
            'Selected events either have descriptions or no source URLs to fetch from.',
        })
        return
      }

      // Reset state
      shouldStopRef.current = false
      totalProcessedRef.current = 0
      totalToProcessRef.current = total
      setIsEnriching(true)

      try {
        // Execute enrichments in order
        for (const method of EXECUTION_ORDER) {
          // Check stop flag before each method
          if (shouldStopRef.current) {
            break
          }

          const methodEvents = byMethod.get(method) ?? []
          if (methodEvents.length === 0) continue

          // Create a Set of IDs for this method's events
          const methodIds = new Set(methodEvents.map((e) => e.id))

          await executeMethodEnrichment(method, events, methodIds)

          // Update processed count
          totalProcessedRef.current += methodEvents.length
        }

        // Ensure cache is invalidated at the end
        // (Individual hooks also invalidate, but we do it here for safety)
        invalidateEvents()

        // Call completion callback
        onComplete?.()
      } finally {
        setIsEnriching(false)
        setCurrentMethod(null)
      }
    },
    [getEnrichableEventsByMethod, executeMethodEnrichment, invalidateEvents]
  )

  /**
   * Stop all enrichment operations.
   * Stops the current method and prevents subsequent methods from starting.
   */
  const stop = useCallback(() => {
    shouldStopRef.current = true

    // Stop the currently running method
    if (currentMethod === 'passline') {
      passlineEnrichment.stopPasslineEnrichment()
    } else if (currentMethod === 'luma') {
      lumaEnrichment.stopLumaEnrichment()
    } else if (currentMethod === 'background') {
      backgroundEnrichment.stopEnrichment()
    }
  }, [currentMethod, passlineEnrichment, lumaEnrichment, backgroundEnrichment])

  // Compute unified isEnriching state from all sources
  const isAnyEnriching =
    isEnriching ||
    backgroundEnrichment.isEnriching ||
    passlineEnrichment.isPasslineEnriching ||
    lumaEnrichment.isLumaEnriching

  return {
    // State
    isEnriching: isAnyEnriching,
    progress: {
      isEnriching: isAnyEnriching,
      current: totalProcessedRef.current,
      total: totalToProcessRef.current,
      currentMethod,
    } as EnrichmentProgress,

    // Count helpers
    getEnrichableCount,
    getEnrichableCountByMethod,

    // Actions
    enrichDescriptions,
    stop,
  }
}

export type UseUnifiedDescriptionEnrichmentReturn = ReturnType<
  typeof useUnifiedDescriptionEnrichment
>
