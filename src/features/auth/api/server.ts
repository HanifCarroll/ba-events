import { createServerFn } from '@tanstack/react-start'
import type { EmailOtpType } from '@supabase/supabase-js'
import type { Locale } from '@/shared/lib/types'

// ============================================
// Server-side auth functions (cookie-based)
// ============================================

/**
 * Sign out (server-side).
 * Clears session cookies and redirects to home.
 */
export const signOutAction = createServerFn({ method: 'POST' }).handler(
  async () => {
    const { createSupabaseServerClient } = await import('@/shared/lib/db/server')
    const supabase = createSupabaseServerClient()
    await supabase.auth.signOut()
    return { success: true }
  }
)

/**
 * Exchange auth code or token hash for session (server-side).
 * Used for magic link callback. Sets session cookies.
 */
export const exchangeCodeAction = createServerFn({ method: 'POST' }).validator((data: { code?: string; tokenHash?: string; type?: string }) => data)
  .handler(async ({ data }) => {
    const { createSupabaseServerClient } = await import('@/shared/lib/db/server')
    const supabase = createSupabaseServerClient()

    // Handle PKCE code exchange
    if (data.code) {
      const { data: sessionData, error } =
        await supabase.auth.exchangeCodeForSession(data.code)

      if (error) {
        throw error
      }

      // Fetch profile for redirect decision
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', sessionData.user.id)
        .single()

      return {
        user: sessionData.user,
        isAdmin: profile?.role === 'admin',
      }
    }

    // Handle token hash (magic link with PKCE)
    if (data.tokenHash && data.type) {
      const { data: sessionData, error } = await supabase.auth.verifyOtp({
        token_hash: data.tokenHash,
        type: data.type as EmailOtpType,
      })

      if (error) {
        throw error
      }

      if (!sessionData.user) {
        throw new Error('Failed to verify magic link')
      }

      // Fetch profile for redirect decision
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', sessionData.user.id)
        .single()

      return {
        user: sessionData.user,
        isAdmin: profile?.role === 'admin',
      }
    }

    throw new Error('No valid auth parameters provided')
  })

// Delete user account - requires service role key (server-side only)
export const deleteAccountAction = createServerFn({ method: 'POST' }).validator((data: { userId: string }) => data)
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

/**
 * Update locale preference in profiles table (server-side).
 * Persists user's language preference across devices.
 */
export const updateLocalePreference = createServerFn({ method: 'POST' }).validator((locale: Locale) => locale)
  .handler(async ({ data: locale }) => {
    const { createSupabaseServerClient } = await import('@/shared/lib/db/server')
    const supabase = createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      throw new Error('Must be logged in to update locale preference')
    }

    const { error } = await supabase
      .from('profiles')
      .update({ locale, updated_at: new Date().toISOString() })
      .eq('id', user.id)

    if (error) {
      throw error
    }

    return { success: true }
  })
