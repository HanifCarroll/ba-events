import { getLocale } from '#paraglide/runtime.js'
import { browser } from '$app/env'

export type AnalyticsEvent =
  | 'chat:message_sent'
  | 'chat:response_received'
  | 'chat:event_clicked'
  | 'chat:error'
  | 'event:saved'
  | 'event:unsaved'
  | 'event:link_clicked'
  | 'feedback:submitted'
  | 'telegram:link_clicked'

// Lazy-loaded PostHog instance (client-side only)
let posthogInstance: typeof import('posthog-js').default | null = null
let posthogPromise: Promise<typeof import('posthog-js').default> | null = null
const ANALYTICS_HOSTS = new Set(['baeventos.com', 'www.baeventos.com'])

export function isAnalyticsEnabled(): boolean {
  return browser && ANALYTICS_HOSTS.has(window.location.hostname)
}

async function getPostHog() {
  if (!isAnalyticsEnabled()) return null
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
  if (!isAnalyticsEnabled()) return

  getPostHog().then(posthog => {
    if (posthog) {
      posthog.capture(event, {
        ...properties,
        locale: getLocale(),
      })
    }
  })
}
