import { createFileRoute, Outlet } from '@tanstack/react-router'
import { requireAdmin } from '@/features/auth/api/session'

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
    <div className="h-full overflow-hidden">
      <div className="h-full p-4 lg:p-8 flex flex-col min-h-0 overflow-x-hidden">
        <div className="flex-1 min-h-0 overflow-auto overflow-x-hidden">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
