import { createFileRoute } from '@tanstack/react-router'
import { getBlocklistEntryAction } from '@/features/import'
import { BlocklistForm } from './-components/BlocklistForm'

export const Route = createFileRoute('/admin/blocklist/$id')({
  loader: async ({ params }) => {
    return getBlocklistEntryAction({ data: params.id })
  },
  component: EditBlocklistPage,
})

function EditBlocklistPage() {
  const entry = Route.useLoaderData()
  return <BlocklistForm mode="edit" entry={entry} />
}
