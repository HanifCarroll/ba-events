import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Menu,
  X,
  Home,
  MessageSquarePlus,
  Bookmark,
  Settings,
  LogOut,
  User,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  Calendar,
  MapPin,
} from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
import { SkipLink } from '@/shared/ui/SkipLink'
import { useAuthContext } from '@/features/auth'
import { signOutAction } from '@/features/auth'
import { track } from '@/lib/analytics'
import { LanguageSwitcher } from '@/routes/-components/LanguageSwitcher'
import * as m from '@/paraglide/messages'

interface MainLayoutProps {
  children: React.ReactNode
}

interface NavItem {
  to?: string
  label: string
  icon: typeof Home
  action?: () => void
  requiresAuth?: boolean
  adminOnly?: boolean
  showWhenHasMessages?: boolean
  exact?: boolean
}

export function MainLayout({ children }: MainLayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user, profile, isAdmin } = useAuthContext()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [hasMessages, setHasMessages] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('sidebar-collapsed') === 'true'
    }
    return false
  })

  // Wrap signOutAction with useServerFn for server-side sign-out
  const signOut = useServerFn(signOutAction)

  // Listen for chat state changes
  useEffect(() => {
    const handleChatStateChange = (e: CustomEvent<{ hasMessages: boolean }>) => {
      setHasMessages(e.detail.hasMessages)
    }
    window.addEventListener('chat-state-change', handleChatStateChange as EventListener)
    return () => window.removeEventListener('chat-state-change', handleChatStateChange as EventListener)
  }, [])

  // Persist collapsed state
  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(collapsed))
  }, [collapsed])

  const handleNewChat = () => {
    window.dispatchEvent(new CustomEvent('new-chat'))
    setMobileMenuOpen(false)
  }

  const handleSignOut = async () => {
    setIsSigningOut(true)
    try {
      await signOut()
      track('auth:logout')
      queryClient.setQueryData(['session'], null)
      queryClient.invalidateQueries({ queryKey: ['session'] })
      navigate({ to: '/' })
    } catch (err) {
      console.error('Sign out error:', err)
    } finally {
      setIsSigningOut(false)
    }
  }

  const isActive = (to: string, exact?: boolean) => {
    if (exact || to === '/') {
      return location.pathname === to
    }
    return location.pathname.startsWith(to)
  }

  const mainNavItems: NavItem[] = [
    { to: '/', label: m.nav_home(), icon: Home },
    { label: m.nav_new_chat(), icon: MessageSquarePlus, action: handleNewChat, showWhenHasMessages: true },
    { to: '/saved', label: m.nav_saved(), icon: Bookmark, requiresAuth: true },
    { to: '/profile', label: m.nav_settings(), icon: Settings, requiresAuth: true },
  ]

  const adminNavItems: NavItem[] = [
    { to: '/admin', label: m.nav_dashboard(), icon: LayoutDashboard, adminOnly: true, exact: true },
    { to: '/admin/events', label: m.nav_events(), icon: Calendar, adminOnly: true },
    { to: '/admin/venues', label: m.nav_venues(), icon: MapPin, adminOnly: true },
  ]

  const filterNavItems = (items: NavItem[]) => items.filter((item) => {
    if (item.adminOnly && !isAdmin) return false
    if (item.requiresAuth && !user) return false
    if (item.showWhenHasMessages && !hasMessages) return false
    return true
  })

  const filteredMainNavItems = filterNavItems(mainNavItems)
  const filteredAdminNavItems = filterNavItems(adminNavItems)

  const NavItemComponent = ({ item, showLabel }: { item: NavItem; showLabel: boolean }) => {
    const Icon = item.icon
    const active = item.to ? isActive(item.to, item.exact) : false

    const content = (
      <div
        className={`
          group flex items-center gap-3 rounded-xl
          transition-all duration-200 cursor-pointer
          ${showLabel ? 'px-4 py-3' : 'p-3 justify-center'}
          ${
            active
              ? 'bg-primary/10 text-primary border border-primary/20 shadow-[0_0_20px_oklch(0.78_0.14_75/0.08)]'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }
        `}
      >
        <Icon className={`h-5 w-5 shrink-0 ${active ? 'text-primary' : ''}`} />
        {showLabel && <span className="font-medium truncate">{item.label}</span>}
        {showLabel && active && (
          <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
        )}
      </div>
    )

    if (item.action) {
      return (
        <button onClick={item.action} className="w-full text-left">
          {content}
        </button>
      )
    }

    return (
      <Link to={item.to!} onClick={() => setMobileMenuOpen(false)}>
        {content}
      </Link>
    )
  }

  return (
    <div className="h-full flex flex-col lg:flex-row overflow-hidden">
      <SkipLink />

      {/* Mobile header */}
      <header className="lg:hidden h-16 border-b border-border/50 bg-card/80 backdrop-blur-sm flex items-center gap-3 px-4 shrink-0 z-30">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
        <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <div className="relative">
            <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 via-primary/10 to-transparent blur-sm" />
            <div className="relative flex items-center gap-2">
              <div className="w-1 h-6 bg-gradient-to-b from-primary to-accent rounded-full" />
              <span className="font-display text-lg font-semibold">BA Eventos</span>
            </div>
          </div>
        </Link>
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
          border-r border-border/50 bg-card/95 backdrop-blur-sm
          transform transition-all duration-300 ease-in-out
          ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          ${collapsed ? 'lg:w-16' : 'lg:w-64'}
          w-64 flex flex-col shrink-0 h-full
        `}
      >
        {/* Sidebar header */}
        <div className="h-16 border-b border-border/50 flex items-center justify-between px-4 shrink-0">
          <Link
            to="/"
            className={`flex items-center gap-3 hover:opacity-80 transition-opacity overflow-hidden ${collapsed ? 'lg:justify-center lg:w-full' : ''}`}
          >
            <div className="relative shrink-0">
              <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 via-primary/10 to-transparent blur-sm" />
              <div className="relative w-1 h-6 bg-gradient-to-b from-primary to-accent rounded-full" />
            </div>
            <div className={`overflow-hidden transition-all duration-300 ${collapsed ? 'lg:w-0 lg:opacity-0' : 'w-auto opacity-100'}`}>
              <span className="font-display text-lg font-semibold text-foreground whitespace-nowrap">
                BA Eventos
              </span>
            </div>
          </Link>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={`hidden lg:flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-200 ${collapsed ? 'absolute right-2' : ''}`}
            aria-label={collapsed ? m.sidebar_expand() : m.sidebar_collapse()}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 overflow-y-auto flex flex-col">
          {/* Main navigation */}
          <div className="space-y-1">
            {filteredMainNavItems.map((item) => {
              const showLabel = !collapsed || mobileMenuOpen

              if (collapsed && !mobileMenuOpen) {
                return (
                  <Tooltip key={item.label} delayDuration={0}>
                    <TooltipTrigger asChild>
                      <div>
                        <NavItemComponent item={item} showLabel={false} />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="font-medium">
                      {item.label}
                    </TooltipContent>
                  </Tooltip>
                )
              }

              return (
                <NavItemComponent key={item.label} item={item} showLabel={showLabel} />
              )
            })}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Admin section */}
          {filteredAdminNavItems.length > 0 && (
            <div className="space-y-1 pt-3 mt-3 border-t border-border/50">
              {/* Admin section label */}
              <div className={`px-3 py-1 transition-all duration-300 ${collapsed && !mobileMenuOpen ? 'opacity-0 h-0' : 'opacity-100'}`}>
                <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">{m.nav_admin()}</span>
              </div>
              {filteredAdminNavItems.map((item) => {
                const showLabel = !collapsed || mobileMenuOpen

                if (collapsed && !mobileMenuOpen) {
                  return (
                    <Tooltip key={item.label} delayDuration={0}>
                      <TooltipTrigger asChild>
                        <div>
                          <NavItemComponent item={item} showLabel={false} />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="font-medium">
                        {item.label}
                      </TooltipContent>
                    </Tooltip>
                  )
                }

                return (
                  <NavItemComponent key={item.label} item={item} showLabel={showLabel} />
                )
              })}
            </div>
          )}
        </nav>

        {/* Language switcher */}
        <div className="px-3 pb-2">
          <LanguageSwitcher collapsed={collapsed && !mobileMenuOpen} />
        </div>

        {/* Decorative line */}
        <div className={`mx-3 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent ${collapsed && !mobileMenuOpen ? 'mx-2' : ''}`} />

        {/* User section */}
        <div className="p-3">
          {user ? (
            <div className="space-y-2">
              {/* User info - only show when expanded */}
              <div className={`overflow-hidden transition-all duration-300 ${collapsed && !mobileMenuOpen ? 'h-0 opacity-0' : 'h-auto opacity-100 px-3 py-2'}`}>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">{m.auth_signed_in_as()}</p>
                <p className="text-sm text-foreground truncate">{profile?.display_name || user.email?.split('@')[0]}</p>
              </div>
              {/* Sign out button */}
              {collapsed && !mobileMenuOpen ? (
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      onClick={handleSignOut}
                      disabled={isSigningOut}
                      className="w-full p-3 justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    >
                      <LogOut className="h-5 w-5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="font-medium">
                    {isSigningOut ? m.auth_signing_out() : m.auth_sign_out()}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Button
                  variant="ghost"
                  onClick={handleSignOut}
                  disabled={isSigningOut}
                  className="w-full justify-start gap-3 px-4 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                >
                  <LogOut className="h-5 w-5" />
                  <span className={`transition-all duration-300 ${collapsed && !mobileMenuOpen ? 'w-0 opacity-0' : 'w-auto opacity-100'}`}>
                    {isSigningOut ? m.auth_signing_out() : m.auth_sign_out()}
                  </span>
                </Button>
              )}
            </div>
          ) : (
            /* Sign in button */
            collapsed && !mobileMenuOpen ? (
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <Link to="/login" className="block">
                    <Button
                      variant="outline"
                      className="w-full p-3 justify-center border-primary/30 text-primary hover:bg-primary/10 hover:border-primary/50"
                    >
                      <User className="h-5 w-5" />
                    </Button>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" className="font-medium">
                  {m.auth_sign_in()}
                </TooltipContent>
              </Tooltip>
            ) : (
              <Link to="/login" onClick={() => setMobileMenuOpen(false)}>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-3 px-4 border-primary/30 text-primary hover:bg-primary/10 hover:border-primary/50"
                >
                  <User className="h-5 w-5" />
                  <span>{m.auth_sign_in()}</span>
                </Button>
              </Link>
            )
          )}
        </div>
      </aside>

      {/* Main content */}
      <main id="main-content" className="flex-1 h-full overflow-hidden relative">
        {/* Background gradient */}
        <div className="fixed inset-0 bg-gradient-to-br from-primary/[0.02] via-transparent to-accent/[0.03] pointer-events-none" />

        <div className="relative h-full">
          {children}
        </div>
      </main>
    </div>
  )
}
