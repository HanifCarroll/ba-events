import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { nodeRealtimeOptions } from './node-realtime.ts'

let serviceRoleClient: SupabaseClient | null = null

export function getSupabaseServiceRoleClient(): SupabaseClient {
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
    ...nodeRealtimeOptions,
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  return serviceRoleClient
}
