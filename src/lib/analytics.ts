import { getLocale } from '@/paraglide/runtime'

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

export type AnalyticsEvent =
  | ChatEvent
  | EventEngagementEvent
  | AuthEvent
  | AdminEvent

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
