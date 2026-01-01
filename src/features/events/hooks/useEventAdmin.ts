import { useEventFiltering, type UseEventFilteringOptions } from './useEventFiltering'
import { useBulkActions } from './useBulkActions'
import { useMarkPastEvents } from './useMarkPastEvents'
import { useSingleEventActions } from './useSingleEventActions'
import { useDescriptionEnrichment } from './useDescriptionEnrichment'

/**
 * Orchestrating hook that combines all event admin functionality
 */
export function useEventAdmin(options: UseEventFilteringOptions) {
  const filtering = useEventFiltering(options)
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
