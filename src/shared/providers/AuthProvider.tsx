import { createContext, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSessionUser, type SessionUser } from '@/features/auth'
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
  const { data: sessionUser, isLoading } = useQuery({
    queryKey: ['session'],
    queryFn: () => getSessionUser(),
    // Use SSR data as initial data to prevent flash of logged-out state
    initialData: initialSession ?? undefined,
    staleTime: 1000 * 60 * 5, // Consider fresh for 5 minutes
    refetchOnWindowFocus: true,
  })

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
    </AuthContext.Provider>
  )
}
