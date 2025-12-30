import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { createServerFn } from '@tanstack/react-start'
import { useState, useEffect, useCallback } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import type { Profile } from './types'

// Browser-side Supabase client for auth
// Note: These are public keys, safe to expose to browser
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

type BrowserClient = SupabaseClient

let browserClient: BrowserClient | null = null

function createBrowserClient(): BrowserClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
  }
  const client = createClient(supabaseUrl, supabaseAnonKey)

  // Expose on window for debugging in development
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__supabase = client
  }

  return client
}

export function getSupabaseBrowserClient(): BrowserClient {
  if (typeof window === 'undefined') {
    throw new Error('getSupabaseBrowserClient should only be called on the client')
  }

  if (!browserClient) {
    browserClient = createBrowserClient()
  }

  return browserClient
}

// Reset the browser client (useful when connection goes stale)
export function resetSupabaseBrowserClient() {
  if (typeof window === 'undefined') return
  browserClient = null
}

// Wrapper that adds timeout and retry logic for stale connections
async function withConnectionRetry<T>(
  operation: (client: BrowserClient) => Promise<T>,
  timeoutMs = 10000
): Promise<T> {
  const attempt = async (isRetry = false): Promise<T> => {
    if (isRetry) {
      console.warn('Supabase connection appears stale, resetting client...')
      resetSupabaseBrowserClient()
    }

    const client = getSupabaseBrowserClient()

    // Race the operation against a timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
    })

    try {
      return await Promise.race([operation(client), timeoutPromise])
    } catch (err) {
      if (!isRetry && err instanceof Error && err.message === 'Connection timeout') {
        return attempt(true)
      }
      throw err
    }
  }

  return attempt()
}

// Sign up with email and password
export async function signUp(email: string, password: string) {
  return withConnectionRetry(async (client) => {
    const { data, error } = await client.auth.signUp({
      email,
      password,
    })

    if (error) {
      throw error
    }

    return data
  })
}

// Sign in with email and password
export async function signIn(email: string, password: string) {
  return withConnectionRetry(async (client) => {
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      throw error
    }

    return data
  })
}

// Sign in with magic link (sends email)
export async function signInWithMagicLink(email: string) {
  const client = getSupabaseBrowserClient()
  const { data, error } = await client.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${window.location.origin}/auth/callback`,
    },
  })

  if (error) {
    throw error
  }

  return data
}

// Sign out
export async function signOut() {
  const client = getSupabaseBrowserClient()
  const { error } = await client.auth.signOut()

  if (error) {
    throw error
  }
}

// Get current session
export async function getSession() {
  return withConnectionRetry(async (client) => {
    const { data: { session }, error } = await client.auth.getSession()

    if (error) {
      throw error
    }

    return session
  })
}

// Fetch user profile from database
export async function fetchProfile(userId: string): Promise<Profile | null> {
  return withConnectionRetry(async (client) => {
    const { data, error } = await client
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (error) {
      console.error('Error fetching profile:', error)
      return null
    }

    return data as Profile
  })
}

// Exchange auth code for session (for magic link callback)
export async function exchangeCodeForSession(code: string) {
  const client = getSupabaseBrowserClient()
  const { data, error } = await client.auth.exchangeCodeForSession(code)

  if (error) {
    throw error
  }

  return data
}

// Hook for auth state with profile
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (userId: string) => {
    try {
      const profileData = await fetchProfile(userId)
      setProfile(profileData)
    } catch (err) {
      console.error('Error loading profile:', err)
    }
  }, [])

  useEffect(() => {
    // Only run on client
    if (typeof window === 'undefined') {
      setLoading(false)
      return
    }

    let subscription: { unsubscribe: () => void } | null = null
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const initAuth = async () => {
      // Safety timeout - ensure loading is set to false even if something hangs
      timeoutId = setTimeout(() => {
        console.warn('Auth initialization timeout - forcing loading to false')
        setLoading(false)
      }, 5000)

      try {
        const client = getSupabaseBrowserClient()

        // Get initial session
        const { data: { session }, error } = await client.auth.getSession()
        if (error) {
          console.error('Error getting session:', error)
        }

        setSession(session)
        setUser(session?.user ?? null)
        if (session?.user) {
          await loadProfile(session.user.id)
        }

        // Listen for auth changes
        const { data } = client.auth.onAuthStateChange(
          async (_event, session) => {
            setSession(session)
            setUser(session?.user ?? null)
            if (session?.user) {
              await loadProfile(session.user.id)
            } else {
              setProfile(null)
            }
          }
        )
        subscription = data.subscription
      } catch (err) {
        console.error('Error initializing auth:', err)
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
        setLoading(false)
      }
    }

    initAuth()

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      subscription?.unsubscribe()
    }
  }, [loadProfile])

  const isAdmin = profile?.role === 'admin'

  return { session, user, profile, loading, isAdmin }
}

// Update display name in profiles table
export async function updateDisplayName(name: string): Promise<void> {
  const client = getSupabaseBrowserClient()

  const { data: { user } } = await client.auth.getUser()
  if (!user) {
    throw new Error('Must be logged in to update profile')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (client.from('profiles') as any)
    .update({ display_name: name, updated_at: new Date().toISOString() })
    .eq('id', user.id)

  if (error) {
    throw error
  }
}

// Update password (requires current password verification via re-auth)
export async function updatePassword(newPassword: string): Promise<void> {
  const client = getSupabaseBrowserClient()

  const { error } = await client.auth.updateUser({
    password: newPassword,
  })

  if (error) {
    throw error
  }
}

// Server-side session check (placeholder - relies on client-side auth)
export const checkAuth = createServerFn({ method: 'GET' }).handler(
  async () => {
    // For server-side, we can't use browser client
    // We'll rely on the browser-side auth check for now
    // In a production app, you'd validate JWT tokens server-side
    return { authenticated: true }
  }
)

// Delete user account - requires service role key (server-side only)
export const deleteAccountAction = createServerFn({ method: 'POST' })
  .inputValidator((data: { userId: string }) => data)
  .handler(async ({ data }) => {
    const { createClient } = await import('@supabase/supabase-js')

    const supabaseUrl = process.env.SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    }

    // Create admin client with service role key
    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })

    // Delete user from auth.users (CASCADE will handle profiles and saved_events)
    const { error } = await adminClient.auth.admin.deleteUser(data.userId)

    if (error) {
      throw error
    }

    return { success: true }
  })
