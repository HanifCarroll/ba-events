/**
 * Server-side Analytics
 *
 * This file is for server-only PostHog tracking using posthog-node.
 * It MUST NOT be imported from client-side code.
 *
 * For client-side tracking, use analytics.ts instead.
 */

import { PostHog } from 'posthog-node'
import type { AnalyticsEvent } from './analytics.ts'

// Server-side PostHog client (lazy initialized)
let serverPostHogClient: PostHog | null = null

function getServerPostHog(): PostHog | null {
  if (serverPostHogClient) return serverPostHogClient

  // Canonical variable — the same PUBLIC_POSTHOG_KEY the browser build reads.
  // This key is a public PostHog project key by design (client-side readable).
  const apiKey = process.env.PUBLIC_POSTHOG_KEY
  if (!apiKey) {
    console.warn('[Analytics] PUBLIC_POSTHOG_KEY not set, server-side tracking disabled')
    return null
  }

  serverPostHogClient = new PostHog(apiKey, {
    host: 'https://us.i.posthog.com',
    flushAt: 1, // Flush immediately for serverless
    flushInterval: 0,
  })

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
