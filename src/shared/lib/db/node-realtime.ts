import WebSocket from 'ws'
import type { SupabaseClientOptions } from '@supabase/supabase-js'

type RealtimeTransport = NonNullable<
  NonNullable<SupabaseClientOptions<'public'>['realtime']>['transport']
>

/**
 * Supabase no longer bundles a Node WebSocket fallback. Trigger.dev currently
 * builds jobs on Node 21, so server clients must provide one explicitly.
 */
export const nodeRealtimeOptions = {
  realtime: {
    // `ws` accepts the same runtime inputs, but its overload declarations are
    // broader than Supabase's minimal constructor type.
    transport: WebSocket as unknown as RealtimeTransport,
  },
}
