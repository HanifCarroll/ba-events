import { createFileRoute, Outlet, Link, useLocation, useNavigate } from '@tanstack/react-router'
import { Calendar, MapPin, LayoutDashboard, LogOut, Menu, X } from 'lucide-react'
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { useAuth, signOut } from '@/lib/auth'

export const Route = createFileRoute('/admin')({
  component: AdminLayout,
})

const navItems = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/admin/events', label: 'Events', icon: Calendar },
  { to: '/admin/venues', label: 'Venues', icon: MapPin },
]

function AdminLayout() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !user && location.pathname !== '/admin/login') {
      navigate({ to: '/admin/login' })
    }
  }, [loading, user, location.pathname, navigate])

  // Don't show layout for login page
  if (location.pathname === '/admin/login') {
    return <Outlet />
  }

  // Show loading while checking auth
  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <div className="animate-pulse-warm text-primary">Loading...</div>
      </div>
    )
  }

  // Don't render if not authenticated
  if (!user) {
    return null
  }

  async function handleSignOut() {
    setIsSigningOut(true)
    try {
      await signOut()
      navigate({ to: '/admin/login' })
    } catch (err) {
      console.error('Sign out error:', err)
    } finally {
      setIsSigningOut(false)
    }
  }

  function isActive(to: string, exact?: boolean) {
    if (exact) {
      return location.pathname === to
    }
    return location.pathname.startsWith(to)
  }

  return (
    <div className="min-h-full flex flex-col lg:flex-row">
      {/* Mobile header */}
      <header className="lg:hidden h-16 border-b border-border/50 bg-card/80 backdrop-blur-sm flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-1 h-6 bg-gradient-to-b from-primary to-accent rounded-full" />
          <span className="font-display text-lg font-semibold">BA Events</span>
          <span className="text-xs text-muted-foreground tracking-wider uppercase">Admin</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="text-muted-foreground hover:text-foreground"
        >
          {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </header>

      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-background/80 backdrop-blur-sm"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-50
          w-64 border-r border-border/50 bg-card/95 backdrop-blur-sm
          transform transition-transform duration-300 ease-in-out
          ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          flex flex-col
        `}
      >
        {/* Sidebar header */}
        <div className="h-16 border-b border-border/50 flex items-center px-6 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-1 h-6 bg-gradient-to-b from-primary to-accent rounded-full" />
            <div>
              <span className="font-display text-lg font-semibold text-foreground">BA Events</span>
              <span className="ml-2 text-xs text-primary tracking-wider uppercase font-medium">Admin</span>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = isActive(item.to, item.exact)
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMobileMenuOpen(false)}
                className={`
                  group flex items-center gap-3 px-4 py-3 rounded-xl
                  transition-all duration-200
                  ${
                    active
                      ? 'bg-primary/10 text-primary border border-primary/20'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  }
                `}
              >
                <Icon className={`h-5 w-5 ${active ? 'text-primary' : ''}`} />
                <span className="font-medium">{item.label}</span>
                {active && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />
                )}
              </Link>
            )
          })}
        </nav>

        {/* User section */}
        <div className="p-4 border-t border-border/50">
          <div className="px-4 py-2 mb-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Signed in as</p>
            <p className="text-sm text-foreground truncate">{user.email}</p>
          </div>
          <Button
            variant="ghost"
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="w-full justify-start gap-3 px-4 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          >
            <LogOut className="h-5 w-5" />
            {isSigningOut ? 'Signing out...' : 'Sign out'}
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-h-full overflow-auto">
        {/* Background gradient */}
        <div className="fixed inset-0 bg-gradient-to-br from-primary/[0.02] via-transparent to-accent/[0.03] pointer-events-none" />

        <div className="relative p-4 lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
