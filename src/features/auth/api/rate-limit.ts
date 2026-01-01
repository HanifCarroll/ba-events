import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// Only initialize if env vars are present (allows local dev without rate limiting)
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null

// Rate limit configuration for chat/general use
export const RATE_LIMIT_REQUESTS = 30
export const RATE_LIMIT_WINDOW = '1 h'

// Rate limit configuration for external API
export const API_RATE_LIMIT_REQUESTS = 10
export const API_RATE_LIMIT_WINDOW = '1 m'

// Create rate limiter: 30 requests per hour per IP (for chat)
const rateLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW),
      analytics: true,
      prefix: 'ba-events',
    })
  : null

// Create stricter rate limiter: 10 requests per minute per IP (for external API)
const apiRateLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(API_RATE_LIMIT_REQUESTS, API_RATE_LIMIT_WINDOW),
      analytics: true,
      prefix: 'ba-events-api',
    })
  : null

// Check rate limit - returns success:true if no rate limiting configured
export async function checkRateLimit(ip: string): Promise<{
  success: boolean
  remaining: number
  reset: number
}> {
  // Skip rate limiting if not configured (local dev)
  if (!rateLimiter) {
    return { success: true, remaining: 999, reset: 0 }
  }

  const { success, remaining, reset } = await rateLimiter.limit(ip)
  return { success, remaining, reset }
}

// Check rate limit for external API (stricter: 10 req/min)
export async function checkApiRateLimit(ip: string): Promise<{
  success: boolean
  remaining: number
  reset: number
}> {
  // Skip rate limiting if not configured (local dev)
  if (!apiRateLimiter) {
    return { success: true, remaining: 999, reset: 0 }
  }

  const { success, remaining, reset } = await apiRateLimiter.limit(ip)
  return { success, remaining, reset }
}
