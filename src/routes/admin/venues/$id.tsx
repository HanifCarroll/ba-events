import { createFileRoute } from '@tanstack/react-router'
import { VenueForm } from '@/components/admin/VenueForm'
import { getVenue } from '@/lib/admin'

export const Route = createFileRoute('/admin/venues/$id')({
  loader: async ({ params }) => {
    return getVenue({ data: params.id })
  },
  component: EditVenuePage,
})

function EditVenuePage() {
  const venue = Route.useLoaderData()
  return <VenueForm mode="edit" venue={venue} />
}
