import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { listVenues } from '@/features/venues'
import {
  listActiveEventsAdmin,
  getEventTabCountsAction,
} from '@/features/events'

// Schema for URL search params - single source of truth for all filter state
const eventSearchSchema = z.object({
  // Tab filter
  tab: z.enum(['all', 'needs_attention', 'pending_review', 'past']).optional().catch('all'),
  // Quick filters (moved from React state to URL)
  search: z.string().optional(),
  venue: z.string().optional(), // venue ID filter
  importedToday: z.boolean().optional(), // Filter for recently imported events
  // View preferences
  showPast: z.boolean().optional().catch(false), // Default: false (hide past events)
  // Data gap filters (for needs_attention tab) - server-side
  missingDescription: z.boolean().optional(),
  missingVenue: z.boolean().optional(),
  missingLink: z.boolean().optional(),
  // Column filters (for DataTable)
  name: z.string().optional(),
  venue_name: z.string().optional(),
  source: z.string().optional(),
  status: z.string().optional(),
  // Sorting (column and direction)
  sortBy: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
})

export const Route = createFileRoute('/admin/events/')({
  validateSearch: eventSearchSchema,
  loader: async () => {
    // Fetch active events, venues, and tab counts in parallel
    // Past events are lazy-loaded when user clicks the "Past" tab
    const [venues, activeEvents, tabCounts] = await Promise.all([
      listVenues(),
      listActiveEventsAdmin(),
      getEventTabCountsAction({ data: {} }),
    ])
    return { venues, activeEvents, tabCounts }
  },
})
