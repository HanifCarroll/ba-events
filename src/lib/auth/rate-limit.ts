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

// Create rate limiter: 10 requests per hour per IP
const rateLimiter = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, '1 h'),
      analytics: true,
      prefix: 'ba-events',
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
