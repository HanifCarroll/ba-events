import { useEventFiltering, type EventTab } from './useEventFiltering'
import { useBulkActions } from './useBulkActions'
import { useMarkPastEvents } from './useMarkPastEvents'
import { useSingleEventActions } from './useSingleEventActions'
import { useDescriptionEnrichment } from './useDescriptionEnrichment'
import type { EventWithVenue } from '@/lib/types'

/**
 * Orchestrating hook that combines all event admin functionality
 */
export function useEventAdmin(events: EventWithVenue[], activeTab: EventTab = 'all') {
  const filtering = useEventFiltering(events, activeTab)
  const bulk = useBulkActions(filtering.filteredEvents)
  const markPast = useMarkPastEvents()
  const singleActions = useSingleEventActions()
  const enrichment = useDescriptionEnrichment()

  return {
    filtering,
    bulk,
    markPast,
    singleActions,
    enrichment,
  }
}

export type UseEventAdminReturn = ReturnType<typeof useEventAdmin>
