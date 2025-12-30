import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useAuthContext } from '@/components/AuthProvider'

export const Route = createFileRoute('/admin')({
  component: AdminLayout,
})

function AdminLayout() {
  const { user, loading, isAdmin } = useAuthContext()
  const navigate = useNavigate()

  // Redirect to login if not authenticated, or to home if not admin
  useEffect(() => {
    if (!loading) {
      if (!user) {
        navigate({ to: '/login' })
      } else if (!isAdmin) {
        // User is logged in but not an admin
        navigate({ to: '/' })
      }
    }
  }, [loading, user, isAdmin, navigate])

  // Show loading while checking auth
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-pulse-warm text-primary">Loading...</div>
      </div>
    )
  }

  // Don't render if not authenticated or not admin
  if (!user || !isAdmin) {
    return null
  }

  return (
    <div className="h-full overflow-auto">
      <div className="p-4 lg:p-8">
        <Outlet />
      </div>
    </div>
  )
}
