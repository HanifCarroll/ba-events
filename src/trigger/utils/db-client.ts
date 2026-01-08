/**
 * Service Role Database Client
 *
 * Creates a Supabase client with service role privileges for background jobs.
 * This bypasses Row Level Security (RLS) for admin operations.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let serviceRoleClient: SupabaseClient | null = null

/**
 * Creates or returns a cached Supabase client with service role privileges.
 * This client bypasses RLS and should only be used in trusted backend contexts.
 */
export function getServiceRoleClient(): SupabaseClient {
  if (serviceRoleClient) {
    return serviceRoleClient
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl) {
    throw new Error('Missing SUPABASE_URL environment variable')
  }

  if (!serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable')
  }

  serviceRoleClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  return serviceRoleClient
}

/**
 * Creates a fresh Supabase client with service role privileges.
 * Use this when you need a new client instance (e.g., for parallel operations).
 */
export function createServiceRoleClient(): SupabaseClient {
  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl) {
    throw new Error('Missing SUPABASE_URL environment variable')
  }

  if (!serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable')
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
