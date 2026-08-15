import { getLocale } from '#paraglide/runtime.js'
import { browser } from '$app/env'

// Chat events - core feature tracking
export type ChatEvent =
  | 'chat:message_sent'
  | 'chat:response_received'
  | 'chat:event_clicked'
  | 'chat:no_results'
  | 'chat:directions_opened'
  | 'chat:final_only_response_emitted'
  | 'chat:response_contract_violation'
  | 'chat:error'
  | 'chat:first_message_handoff'

// Event engagement tracking
export type EventEngagementEvent =
  | 'event:viewed'
  | 'event:saved'
  | 'event:unsaved'
  | 'event:link_clicked'
  | 'event:shared'

// Authentication events
export type AuthEvent =
  | 'auth:login_completed'
  | 'auth:login_failed'
  | 'auth:logout'

// Concierge/recommendation events
export type ConciergeEvent =
  | 'concierge:recommendation_shown'
  | 'concierge:ticket_clicked'
  | 'concierge:refinement_clicked'
  | 'concierge:surprise_me'

// Home screen events
export type HomeEvent =
  | 'home:happening_soon_clicked'

// Agent tool usage events (server-side tracking)
export type AgentToolEvent =
  | 'agent:tool_used'
  | 'search:executed'

export type AnalyticsEvent =
  | ChatEvent
  | EventEngagementEvent
  | AuthEvent
  | ConciergeEvent
  | HomeEvent
  | AgentToolEvent

// Lazy-loaded PostHog instance (client-side only)
let posthogInstance: typeof import('posthog-js').default | null = null
let posthogPromise: Promise<typeof import('posthog-js').default> | null = null

async function getPostHog() {
  if (!browser) return null
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
  if (!browser) return

  getPostHog().then(posthog => {
    if (posthog) {
      posthog.capture(event, {
        ...properties,
        locale: getLocale(),
      })
    }
  })
}
