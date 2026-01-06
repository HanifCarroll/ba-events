import { createFileRoute } from '@tanstack/react-router'
import { BlocklistForm } from './-components/BlocklistForm'

export const Route = createFileRoute('/admin/blocklist/new')({
  component: () => <BlocklistForm mode="create" />,
})
