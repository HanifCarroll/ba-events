import { createContext, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSessionUser } from '@/lib/session'
import type { Session, User } from '@supabase/supabase-js'
import type { Profile } from '@/lib/types'

interface AuthContextValue {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  isAdmin: boolean
}

// Export context for use in useAuthContext hook (separate file for HMR compatibility)
export const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: sessionUser, isLoading } = useQuery({
    queryKey: ['session'],
    queryFn: () => getSessionUser(),
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
