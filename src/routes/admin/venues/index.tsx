import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { listVenues, listAllVenueEventCountsAction } from '@/features/venues'

// URL search params schema
const venueSearchSchema = z.object({
  tab: z.enum(['all', 'missing_neighborhood', 'duplicates', 'address_names']).optional().catch('all'),
  search: z.string().optional(),
  neighborhood: z.string().optional(),
  importedToday: z.boolean().optional(),
})

export type VenueSearchParams = z.infer<typeof venueSearchSchema>

export const Route = createFileRoute('/admin/venues/')({
  validateSearch: venueSearchSchema,
  // Loader doesn't depend on any search params - venues list is static
  // This prevents reloading when editId or other search params change
  loaderDeps: () => ({}),
  loader: async () => {
    const [venues, eventCounts] = await Promise.all([
      listVenues(),
      listAllVenueEventCountsAction(),
    ])
    return { venues, eventCounts }
  },
})
