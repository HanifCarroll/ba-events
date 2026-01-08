import { getSessionUser } from '@/features/auth/api/session'
import type { SupabaseClient } from '@/shared/lib/db/client'

// Re-export mapToNeighborhood for existing imports
export { mapToNeighborhood } from '@/shared/lib/utils/neighborhood'

/**
 * Validates admin access and returns authenticated Supabase client.
 * Throws if user is not authenticated or not an admin.
 * The returned client has the user's session context, enabling RLS policies.
 */
export async function requireAdminAccess(): Promise<SupabaseClient> {
  const session = await getSessionUser()
  if (!session?.isAdmin) {
    throw new Error('Unauthorized: Admin access required')
  }
  // Dynamic import to avoid bundling server-only code in client
  const { createSupabaseServerClient } = await import('@/shared/lib/db/server')
  // Return authenticated client for database operations with RLS
  return createSupabaseServerClient()
}
