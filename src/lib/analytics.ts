import { getLocale } from '@/paraglide/runtime'
import { PostHog } from 'posthog-node'

// Chat events - core feature tracking
export type ChatEvent =
  | 'chat:message_sent'
  | 'chat:response_received'
  | 'chat:event_clicked'
  | 'chat:no_results'
  | 'chat:error'

// Event engagement tracking
export type EventEngagementEvent =
  | 'event:saved'
  | 'event:unsaved'
  | 'event:link_clicked'

// Authentication events
export type AuthEvent =
  | 'auth:login_completed'
  | 'auth:login_failed'
  | 'auth:signup_completed'
  | 'auth:signup_failed'
  | 'auth:logout'

// Admin events
export type AdminEvent =
  | 'admin:event_created'
  | 'admin:event_updated'
  | 'admin:event_deleted'
  | 'admin:venue_created'
  | 'admin:venue_updated'
  | 'admin:venue_deleted'
  | 'admin:import_started'
  | 'admin:import_completed'

// Concierge/recommendation events
export type ConciergeEvent =
  | 'concierge:recommendation_shown'
  | 'concierge:ticket_clicked'
  | 'concierge:refinement_clicked'
  | 'concierge:context_prompt'
  | 'concierge:add_to_calendar'
  | 'concierge:get_directions'
  | 'concierge:share_plan'

// Agent tool usage events (server-side tracking)
export type AgentToolEvent =
  | 'agent:tool_used'

export type AnalyticsEvent =
  | ChatEvent
  | EventEngagementEvent
  | AuthEvent
  | AdminEvent
  | ConciergeEvent
  | AgentToolEvent

// Lazy-loaded PostHog instance (client-side only)
let posthogInstance: typeof import('posthog-js').default | null = null
let posthogPromise: Promise<typeof import('posthog-js').default> | null = null

async function getPostHog() {
  if (typeof window === 'undefined') return null
  if (posthogInstance) return posthogInstance

  if (!posthogPromise) {
    posthogPromise = import('posthog-js').then(m => {
      posthogInstance = m.default
      return m.default
    })
  }

  return posthogPromise
}

/**
 * Track an analytics event with PostHog.
 * Automatically includes locale in all events.
 * No-op during SSR.
 */
export function track(
  event: AnalyticsEvent,
  properties?: Record<string, unknown>
) {
  if (typeof window === 'undefined') return

  getPostHog().then(posthog => {
    if (posthog) {
      posthog.capture(event, {
        ...properties,
        locale: getLocale(),
      })
    }
  })
}

// Server-side PostHog client (lazy initialized)
let serverPostHogClient: PostHog | null = null

function getServerPostHog(): PostHog | null {
  if (typeof window !== 'undefined') return null // Client-side, don't use server client

  if (!serverPostHogClient) {
    const apiKey = process.env.VITE_POSTHOG_KEY
    if (!apiKey) {
      console.warn('[Analytics] VITE_POSTHOG_KEY not set, server-side tracking disabled')
      return null
    }
    serverPostHogClient = new PostHog(apiKey, {
      host: 'https://us.i.posthog.com',
      flushAt: 1, // Flush immediately for serverless
      flushInterval: 0,
    })
  }
  return serverPostHogClient
}

/**
 * Track an analytics event from the server.
 * Used for agent tool usage and other server-side events.
 * @param event - The event name
 * @param distinctId - User ID or 'anonymous' for unauthenticated users
 * @param properties - Additional event properties
 */
export function trackServer(
  event: AnalyticsEvent,
  distinctId: string,
  properties?: Record<string, unknown>
) {
  const client = getServerPostHog()
  if (!client) return

  client.capture({
    distinctId,
    event,
    properties: {
      ...properties,
      source: 'server',
    },
  })
}
