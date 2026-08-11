import { createServerFn } from '@tanstack/react-start'
import { redirect } from '@tanstack/react-router'
import type { User } from '@supabase/supabase-js'
import type { Profile } from '@/shared/lib/types'

export interface SessionUser {
  user: User
  profile: Profile | null
  isAdmin: boolean
}

/**
 * Get the current authenticated user with their profile.
 * Returns null if not authenticated.
 */
export const getSessionUser = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SessionUser | null> => {
    const { createSupabaseServerClient } = await import('@/shared/lib/db/server')
    const supabase = createSupabaseServerClient()

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user) {
      return null
    }

    // Fetch profile for role information
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()

    return {
      user,
      profile: profile as Profile | null,
      isAdmin: profile?.role === 'admin',
    }
  }
)

/**
 * Require authentication - throws redirect to /login if not authenticated.
 * Use this in beforeLoad handlers for protected routes.
 */
export const requireAuth = createServerFn({ method: 'GET' }).validator((data: { redirectTo?: string }) => data)
  .handler(async ({ data }): Promise<SessionUser> => {
    const session = await getSessionUser()

    if (!session) {
      throw redirect({
        to: '/login',
        search: data.redirectTo ? { redirect: data.redirectTo } : undefined,
      })
    }

    return session
  })

/**
 * Require admin role - throws redirect if not authenticated or not admin.
 * Use this in beforeLoad handlers for admin routes.
 */
export const requireAdmin = createServerFn({ method: 'GET' }).validator((data: { redirectTo?: string }) => data)
  .handler(async ({ data }): Promise<SessionUser> => {
    const session = await getSessionUser()

    if (!session) {
      throw redirect({
        to: '/login',
        search: data.redirectTo ? { redirect: data.redirectTo } : undefined,
      })
    }

    if (!session.isAdmin) {
      throw redirect({ to: '/' })
    }

    return session
  })
