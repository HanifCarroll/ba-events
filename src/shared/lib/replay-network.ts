import type { CapturedNetworkRequest } from 'posthog-js'

/** Redact the telemetry copy, including initial document navigation timings. */
export function redactReplayNetworkRequest(request: CapturedNetworkRequest): CapturedNetworkRequest | undefined {
  try {
    const url = new URL(request.name)
    if (!['https:', 'http:'].includes(url.protocol)) return undefined
    url.search = ''
    url.hash = ''
    url.username = ''
    url.password = ''
    return { ...request, name: url.href }
  } catch {
    return undefined
  }
}
