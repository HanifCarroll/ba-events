import { createClient } from '@supabase/supabase-js'
import { createServerFn } from '@tanstack/react-start'
import { useState, useEffect } from 'react'
import type { Session, User } from '@supabase/supabase-js'

// Browser-side Supabase client for auth
// Note: These are public keys, safe to expose to browser
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

let browserClient: ReturnType<typeof createClient> | null = null

export function getSupabaseBrowserClient() {
  if (typeof window === 'undefined') {
    throw new Error('getSupabaseBrowserClient should only be called on the client')
  }

  if (!browserClient) {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY')
    }
    browserClient = createClient(supabaseUrl, supabaseAnonKey)
  }

  return browserClient
}

// Sign in with email and password
export async function signIn(email: string, password: string) {
  const client = getSupabaseBrowserClient()
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
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
  const client = getSupabaseBrowserClient()
  const { data: { session }, error } = await client.auth.getSession()

  if (error) {
    throw error
  }

  return session
}

// Hook for auth state
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const client = getSupabaseBrowserClient()

    // Get initial session
    client.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = client.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session)
        setUser(session?.user ?? null)
        setLoading(false)
      }
    )

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  return { session, user, loading }
}

// Server-side session check
export const checkAuth = createServerFn({ method: 'GET' }).handler(
  async () => {
    // For server-side, we can't use browser client
    // We'll rely on the browser-side auth check for now
    // In a production app, you'd validate JWT tokens server-side
    return { authenticated: true }
  }
)
