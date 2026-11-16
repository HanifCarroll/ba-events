/**
 * Luma's public JSON API (the one luma.com's own pages call).
 *
 * luma.com's HTML pages answer Cloudflare Worker subrequests with 429, while
 * api2.luma.com answers them normally, so the jobs Worker reads Luma only
 * through this API.
 */
export const LUMA_API = 'https://api2.luma.com'

/** A 429 from Luma. The message carries the wait so it survives a Workflow step boundary. */
export class LumaRateLimitError extends Error {
  readonly _tag = 'LumaRateLimitError'
  constructor(readonly retryAfterSeconds: number | null) {
    super(`Luma rate limited (429)${retryAfterSeconds === null ? '' : `; retry after ${retryAfterSeconds}s`}`)
  }
}

/** `Retry-After` as seconds: delta-seconds or an HTTP date. Missing or invalid is null. */
export function parseRetryAfter(header: string | null, now: number = Date.now()): number | null {
  if (!header) return null
  const trimmed = header.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  const at = Date.parse(trimmed)
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - now) / 1000)) : null
}

export async function fetchLumaJson(path: string, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const response = await fetchImpl(`${LUMA_API}${path}`, {
    // No Accept-Language: Luma localizes place names ("Torre Macro") when asked for Spanish.
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  })
  if (response.status === 429) throw new LumaRateLimitError(parseRetryAfter(response.headers.get('retry-after')))
  if (!response.ok) throw new Error(`Luma API ${path.split('?')[0]} failed: ${response.status} ${response.statusText}`)
  return response.json()
}
