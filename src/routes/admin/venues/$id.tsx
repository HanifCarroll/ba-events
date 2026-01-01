import { createFileRoute } from '@tanstack/react-router'
import { VenueForm } from './-components/VenueForm'
import { getVenue } from '@/features/venues'

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
