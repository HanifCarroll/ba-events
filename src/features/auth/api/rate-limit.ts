import { createHash } from 'crypto'
import { getSupabaseServiceRoleClient } from '@/shared/lib/db/service'

// Rate limit configuration for chat/general use
export const RATE_LIMIT_REQUESTS = 50
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

// Rate limit configuration for external API
export const API_RATE_LIMIT_REQUESTS = 10
export const API_RATE_LIMIT_WINDOW_MS = 60 * 1000

type RateLimitRpcResult = {
  success: boolean
  remaining: number
  reset: number
  request_count: number
}

const warnedMessages = new Set<string>()

function warnRateLimitOnce(message: string, error: unknown) {
  if (warnedMessages.has(message)) return
  warnedMessages.add(message)
  console.warn(message, error)
}

function hashIdentifier(scope: string, identifier: string): string {
  return createHash('sha256')
    .update(`${scope}:${identifier}`)
    .digest('hex')
}

async function checkScopedRateLimit(
  scope: string,
  identifier: string,
  maxRequests: number,
  windowMs: number
): Promise<{
  success: boolean
  remaining: number
  reset: number
}> {
  try {
    const client = getSupabaseServiceRoleClient()
    const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000))
    const { data, error } = await client
      .rpc('check_rate_limit', {
        p_scope: scope,
        p_identifier_hash: hashIdentifier(scope, identifier),
        p_max_requests: maxRequests,
        p_window_seconds: windowSeconds,
      })
      .single()

    if (error) {
      throw error
    }

    const result = data as RateLimitRpcResult | null
    if (!result) {
      throw new Error('Rate limit RPC returned no data')
    }

    return {
      success: result.success,
      remaining: result.remaining,
      reset: result.reset,
    }
  } catch (error) {
    warnRateLimitOnce(
      `[rate-limit] Supabase rate limit unavailable for scope "${scope}". Allowing requests.`,
      error
    )
    return {
      success: true,
      remaining: maxRequests,
      reset: Date.now() + windowMs,
    }
  }
}

export async function checkRateLimit(ip: string): Promise<{
  success: boolean
  remaining: number
  reset: number
}> {
  return checkScopedRateLimit('chat', ip || 'unknown-ip', RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW_MS)
}

export async function checkApiRateLimit(ip: string): Promise<{
  success: boolean
  remaining: number
  reset: number
}> {
  return checkScopedRateLimit(
    'public_api',
    ip || 'unknown-ip',
    API_RATE_LIMIT_REQUESTS,
    API_RATE_LIMIT_WINDOW_MS
  )
}
