import { createFileRoute, Outlet } from '@tanstack/react-router'
import { requireAdmin } from '@/lib/auth/session'

export const Route = createFileRoute('/admin')({
  beforeLoad: async () => {
    // This runs on the server before rendering
    // Throws redirect to /login if not authenticated, or / if not admin
    await requireAdmin({ data: { redirectTo: '/admin' } })
  },
  component: AdminLayout,
})

function AdminLayout() {
  return (
    <div className="h-full overflow-auto">
      <div className="p-4 lg:p-8">
        <Outlet />
      </div>
    </div>
  )
}
