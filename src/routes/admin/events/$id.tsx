import { createFileRoute } from '@tanstack/react-router'
import { EventForm } from './-components/EventForm'
import { getEventAction } from '@/features/events'

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
