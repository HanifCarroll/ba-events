import { HeadContent, Link, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { RotateCcw, User, LogOut, Bookmark, Settings, ChevronDown } from 'lucide-react'
import { AuthProvider, useAuthContext } from '@/components/AuthProvider'
import { signOut } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Toaster } from '@/components/ui/sonner'
import { queryClient } from '@/lib/query'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'BA Events - Discover Buenos Aires',
      },
      {
        name: 'description',
        content: 'AI-powered event discovery for Buenos Aires. Find techno nights, jazz bars, tango milongas, and more.',
      },
      {
        name: 'theme-color',
        content: '#1a1612',
      },
    ],
    links: [
      {
        rel: 'preconnect',
        href: 'https://fonts.googleapis.com',
      },
      {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,400&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap',
      },
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),

  component: RootDocument,
})

function RootDocument() {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="bg-background text-foreground antialiased overflow-hidden bg-grain">
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <TooltipProvider>
              <RootLayout />
            </TooltipProvider>
          </AuthProvider>
        </QueryClientProvider>
        <Toaster position="bottom-right" richColors />
        <Scripts />
      </body>
    </html>
  )
}

function RootLayout() {
  const [hasMessages, setHasMessages] = useState(false)
  const { user, profile, isAdmin } = useAuthContext()

  // Listen for chat state changes from ChatContainer
  useEffect(() => {
    const handleChatStateChange = (e: CustomEvent<{ hasMessages: boolean }>) => {
      setHasMessages(e.detail.hasMessages)
    }
    window.addEventListener('chat-state-change', handleChatStateChange as EventListener)
    return () => window.removeEventListener('chat-state-change', handleChatStateChange as EventListener)
  }, [])

  const handleNewChat = () => {
    window.dispatchEvent(new CustomEvent('new-chat'))
  }

  const handleSignOut = async () => {
    await signOut()
  }

  return (
    <>
      {/* Atmospheric gradient overlay */}
      <div className="fixed inset-0 bg-gradient-to-b from-primary/[0.02] via-transparent to-accent/[0.03] pointer-events-none z-0" />

      {/* Header - fixed at top */}
      <header className="fixed top-0 left-0 right-0 h-16 border-b border-border/50 backdrop-blur-sm bg-background/80 z-20">
        <div className="h-full flex items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            {/* Art deco inspired logo accent */}
            <div className="relative">
              <div className="absolute -inset-1 bg-gradient-to-r from-primary/20 via-primary/10 to-transparent blur-sm" />
              <div className="relative flex items-center gap-2">
                <div className="w-1 h-6 bg-gradient-to-b from-primary to-accent rounded-full" />
                <span className="font-display text-xl font-semibold tracking-tight text-foreground">
                  BA Events
                </span>
              </div>
            </div>
            <span className="text-xs text-muted-foreground tracking-widest uppercase hidden sm:inline ml-2">
              Buenos Aires
            </span>
          </Link>

          <div className="flex items-center gap-3">
            {/* New Chat button - only show when there are messages */}
            {hasMessages && (
              <button
                onClick={handleNewChat}
                className="group flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-card/50 transition-all duration-200"
              >
                <RotateCcw className="h-3.5 w-3.5 group-hover:rotate-[-90deg] transition-transform duration-300" />
                <span className="text-xs tracking-wide">New Chat</span>
              </button>
            )}

            {/* Auth section */}
            {user ? (
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <Link to="/admin">
                    <Button variant="ghost" size="sm" className="text-xs">
                      Admin
                    </Button>
                  </Link>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card/30 hover:bg-card/50 transition-colors">
                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground hidden sm:inline">
                        {profile?.display_name || user.email?.split('@')[0]}
                      </span>
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem asChild>
                      <Link to="/saved" className="flex items-center gap-2 cursor-pointer">
                        <Bookmark className="h-4 w-4" />
                        Saved Events
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/profile" className="flex items-center gap-2 cursor-pointer">
                        <Settings className="h-4 w-4" />
                        Settings
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={handleSignOut}
                      className="flex items-center gap-2 cursor-pointer text-muted-foreground"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign Out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : (
              <Link to="/login">
                <Button variant="outline" size="sm" className="text-xs">
                  Sign In
                </Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Main content - positioned below header */}
      <main className="fixed top-16 left-0 right-0 bottom-0 z-10 flex flex-col overflow-hidden">
        <Outlet />
      </main>
    </>
  )
}
