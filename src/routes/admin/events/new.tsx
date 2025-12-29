import { createFileRoute } from '@tanstack/react-router'
import { EventForm } from '@/components/admin/EventForm'

export const Route = createFileRoute('/admin/events/new')({
  component: NewEventPage,
})

function NewEventPage() {
  return <EventForm mode="create" />
}
