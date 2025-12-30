import posthog from 'posthog-js'
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
  | 'admin:import_started'
  | 'admin:import_completed'

export type AnalyticsEvent =
  | ChatEvent
  | EventEngagementEvent
  | AuthEvent
  | AdminEvent

/**
 * Track an analytics event with PostHog.
 * Automatically includes locale in all events.
 */
export function track(
  event: AnalyticsEvent,
  properties?: Record<string, unknown>
) {
  posthog.capture(event, {
    ...properties,
    locale: getLocale(),
  })
}

// Re-export posthog for direct access when needed
export { posthog }
