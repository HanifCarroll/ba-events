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
  | 'mcp:signpost_clicked'
  | 'mcp:endpoint_copied'

// Lazy-loaded PostHog instance (client-side only)
let posthogInstance: typeof import('posthog-js').default | null = null
let posthogPromise: Promise<typeof import('posthog-js').default> | null = null
const ANALYTICS_HOSTS = new Set(['baeventos.com', 'www.baeventos.com'])
const GA_MEASUREMENT_ID = 'G-CXEY3D4SW6'
const CAMPAIGN_PARAMETERS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']
const GA_OUTCOME_EVENTS = new Set<AnalyticsEvent>([
  'chat:response_received',
  'chat:event_clicked',
  'event:saved',
  'event:link_clicked',
])
type AnalyticsWindow = Window & { dataLayer?: unknown[][]; gtag?: (...args: unknown[]) => void }
let lastPageLocation = ''

export function isAnalyticsEnabled(): boolean {
  return browser && ANALYTICS_HOSTS.has(window.location.hostname)
}

export function isGoogleAnalyticsOutcome(event: AnalyticsEvent): boolean {
  return GA_OUTCOME_EVENTS.has(event)
}

export function initializeGoogleAnalytics(pageUrl = window.location.href): void {
  if (!isAnalyticsEnabled() || navigator.doNotTrack === '1') return
  const analyticsWindow = window as AnalyticsWindow
  analyticsWindow.dataLayer ||= []
  analyticsWindow.gtag ||= (...args: unknown[]) => analyticsWindow.dataLayer?.push(args)
  if (!document.querySelector(`script[src*="${GA_MEASUREMENT_ID}"]`)) {
    const script = document.createElement('script')
    script.async = true
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`
    document.head.appendChild(script)
    analyticsWindow.gtag('js', new Date())
    analyticsWindow.gtag('config', GA_MEASUREMENT_ID, {
      allow_ad_personalization_signals: false,
      allow_google_signals: false,
      anonymize_ip: true,
      send_page_view: false,
    })
  }
  const source = new URL(pageUrl)
  const pageLocation = new URL(source.pathname, 'https://baeventos.com')
  for (const key of CAMPAIGN_PARAMETERS) {
    const value = source.searchParams.get(key)
    if (value) pageLocation.searchParams.set(key, value)
  }
  if (pageLocation.href === lastPageLocation) return
  lastPageLocation = pageLocation.href
  analyticsWindow.gtag('event', 'page_view', {
    page_location: pageLocation.href,
    page_path: pageLocation.pathname,
    page_title: document.title,
  })
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

  if (navigator.doNotTrack !== '1' && isGoogleAnalyticsOutcome(event)) {
    ;(window as AnalyticsWindow).gtag?.('event', event.replaceAll(':', '_'), {
      locale: getLocale(),
      transport_type: 'beacon',
    })
  }

  getPostHog().then(posthog => {
    if (posthog) {
      posthog.capture(event, {
        ...properties,
        locale: getLocale(),
      })
    }
  })
}
