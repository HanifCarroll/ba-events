import { createFileRoute } from '@tanstack/react-router'
import { VenueForm } from '@/components/admin/VenueForm'

export const Route = createFileRoute('/admin/venues/new')({
  component: NewVenuePage,
})

function NewVenuePage() {
  return <VenueForm mode="create" />
}
