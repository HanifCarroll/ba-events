import { getSessionUser } from '@/features/auth/api/session'
import type { SupabaseClient } from '@/shared/lib/db/client'
import type { Neighborhood } from '@/shared/lib/types'
import { NEIGHBORHOODS } from '@/shared/lib/types'

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

/**
 * Map scraped neighborhood string to valid Neighborhood type
 * Handles exact matches, partial matches, and common aliases
 */
export function mapToNeighborhood(scraped: string | null | undefined): Neighborhood | null {
  if (!scraped) return null

  const normalized = scraped.trim()

  // Exact match (case-insensitive)
  const exactMatch = NEIGHBORHOODS.find(
    (n) => n.toLowerCase() === normalized.toLowerCase()
  )
  if (exactMatch) return exactMatch

  // Partial match (neighborhood contains scraped or vice versa)
  const partialMatch = NEIGHBORHOODS.find(
    (n) =>
      n.toLowerCase().includes(normalized.toLowerCase()) ||
      normalized.toLowerCase().includes(n.toLowerCase())
  )
  if (partialMatch) return partialMatch

  // Common aliases
  const aliases: Record<string, Neighborhood> = {
    microcentro: 'San Nicolás',
    centro: 'San Nicolás',
    congreso: 'Balvanera',
    once: 'Balvanera',
    abasto: 'Balvanera',
    tribunales: 'San Nicolás',
    'barrio norte': 'Recoleta',
    'cañitas': 'Palermo',
    'las cañitas': 'Palermo',
    soho: 'Palermo',
    'palermo soho': 'Palermo',
    hollywood: 'Palermo',
    'palermo hollywood': 'Palermo',
    botanico: 'Palermo',
    'puerto de frutos': 'Puerto Madero',
  }

  const aliasMatch = aliases[normalized.toLowerCase()]
  if (aliasMatch) return aliasMatch

  return null
}
