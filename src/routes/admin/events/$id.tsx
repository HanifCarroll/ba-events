import { createFileRoute } from '@tanstack/react-router'
import { EventForm } from '@/components/admin/EventForm'
import { getEventAction } from '@/lib/admin'

export const Route = createFileRoute('/admin/events/$id')({
  loader: async ({ params }) => {
    return getEventAction({ data: params.id })
  },
  component: EditEventPage,
})

function EditEventPage() {
  const event = Route.useLoaderData()
  return <EventForm mode="edit" event={event} />
}
