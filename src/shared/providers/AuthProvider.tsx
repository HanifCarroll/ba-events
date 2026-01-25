import { createContext, useState, useEffect, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSessionUser, type SessionUser } from '@/features/auth/api/session'
import { useHasPreferences } from '@/features/auth/hooks/usePreferences'
import {
  PersonalizationPrompt,
  wasPromptDismissed,
} from '@/shared/ui/PersonalizationPrompt'
import type { Session, User } from '@supabase/supabase-js'
import type { Profile } from '@/shared/lib/types'

interface AuthContextValue {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  isAdmin: boolean
}

interface AuthProviderProps {
  children: ReactNode
  /** Initial session data from SSR (route beforeLoad) */
  initialSession?: SessionUser | null
}

// Export context for use in useAuthContext hook (separate file for HMR compatibility)
export const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children, initialSession }: AuthProviderProps) {
  const [showPersonalizationPrompt, setShowPersonalizationPrompt] =
    useState(false)

  const { data: sessionUser, isLoading } = useQuery({
    queryKey: ['session'],
    queryFn: () => getSessionUser(),
    // Use SSR data as initial data to prevent flash of logged-out state
    initialData: initialSession ?? undefined,
    staleTime: 1000 * 60 * 5, // Consider fresh for 5 minutes
    refetchOnWindowFocus: true,
  })

  // Check if user has set up preferences
  const { data: hasPreferences, isLoading: prefsLoading } = useHasPreferences()

  // Show personalization prompt for authenticated users without preferences
  useEffect(() => {
    // Wait for both queries to finish loading
    if (isLoading || prefsLoading) return

    // Only show for authenticated users
    if (!sessionUser?.user) return

    // Don't show if user already has preferences
    if (hasPreferences) return

    // Don't show if user already dismissed the prompt
    if (wasPromptDismissed()) return

    // Show the prompt after a short delay (better UX than immediate popup)
    const timer = setTimeout(() => {
      setShowPersonalizationPrompt(true)
    }, 1500)

    return () => clearTimeout(timer)
  }, [sessionUser?.user, hasPreferences, isLoading, prefsLoading])

  const value: AuthContextValue = {
    session: null, // We don't have the full session object from server
    user: sessionUser?.user ?? null,
    profile: sessionUser?.profile ?? null,
    loading: isLoading,
    isAdmin: sessionUser?.isAdmin ?? false,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
      <PersonalizationPrompt
        open={showPersonalizationPrompt}
        onOpenChange={setShowPersonalizationPrompt}
      />
    </AuthContext.Provider>
  )
}
