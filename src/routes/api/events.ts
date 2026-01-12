import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { createEvent, getEventsWithVenues } from '@/shared/lib/db/client'
import { generateEventEmbedding } from '@/shared/lib/ai/embeddings'
import { checkApiRateLimit } from '@/features/auth'
import { apiSuccess, apiList, apiError, CachePresets, withCache } from '@/shared/lib/api-response'
import { CATEGORIES, EVENT_STATUSES } from '@/shared/lib/types'
import type { EventInsert } from '@/shared/lib/types'

// Zod schema for validating incoming event submission requests
const eventSubmissionSchema = z.object({
  // Required fields
  name: z.string().min(1, 'name is required').max(255, 'name must be 255 characters or less'),
  starts_at: z.string().min(1, 'starts_at is required').refine(
    (val) => !isNaN(Date.parse(val)),
    'starts_at must be a valid ISO date string'
  ),

  // Optional fields
  description_es: z.string().nullable().optional(),
  description_en: z.string().nullable().optional(),
  ends_at: z.string().nullable().optional().refine(
    (val) => val === null || val === undefined || !isNaN(Date.parse(val)),
    'ends_at must be a valid ISO date string'
  ),
  is_all_day: z.boolean().optional().default(false),
  venue_id: z.string().uuid('venue_id must be a valid UUID').nullable().optional(),
  categories: z.array(z.enum(CATEGORIES)).optional().default([]),
  price: z.number().min(0, 'price must be a positive number').nullable().optional(),
  is_free: z.boolean().optional().default(false),
  image_url: z.string().url('image_url must be a valid URL').nullable().optional(),
  link: z.string().url('link must be a valid URL').nullable().optional(),
  ticket_url: z.string().url('ticket_url must be a valid URL').nullable().optional(),
  source: z.string().optional().default('api'),
  external_id: z.string().nullable().optional(),
  status: z.enum(EVENT_STATUSES).optional().default('scheduled'),
})

// Helper to format Zod validation errors
function formatZodErrors(error: z.ZodError<unknown>): string {
  return error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ')
}

// Simple API key auth - set ADMIN_API_KEY in your .env
const API_KEY = process.env.ADMIN_API_KEY
const IS_PRODUCTION = process.env.NODE_ENV === 'production'

function unauthorized() {
  return Response.json(apiError('Unauthorized', 'UNAUTHORIZED'), { status: 401 })
}

function apiKeyNotConfigured() {
  return Response.json(apiError('API key not configured', 'API_KEY_NOT_CONFIGURED'), { status: 500 })
}

function tooManyRequests(reset: number) {
  return Response.json(
    apiError('Too many requests. Please try again later.', 'RATE_LIMITED'),
    {
      status: 429,
      headers: {
        'Retry-After': String(Math.ceil((reset - Date.now()) / 1000)),
      },
    }
  )
}

function checkAuth(request: Request): 'authorized' | 'unauthorized' | 'not_configured' {
  // In production, API key must be configured
  if (IS_PRODUCTION && !API_KEY) {
    return 'not_configured'
  }

  // In development without API key, allow all requests (but log warning)
  if (!API_KEY) {
    console.warn('[API] ADMIN_API_KEY not set - allowing unauthenticated access in development')
    return 'authorized'
  }

  const authHeader = request.headers.get('Authorization')
  if (!authHeader) return 'unauthorized'

  const [type, key] = authHeader.split(' ')
  return type === 'Bearer' && key === API_KEY ? 'authorized' : 'unauthorized'
}

function getClientIP(request: Request): string {
  // Check common headers for client IP (in order of preference)
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    // x-forwarded-for can contain multiple IPs, take the first one
    return forwardedFor.split(',')[0].trim()
  }

  const realIP = request.headers.get('x-real-ip')
  if (realIP) {
    return realIP
  }

  // Fallback to a default identifier
  return 'unknown-ip'
}

async function applyRateLimit(request: Request): Promise<{ allowed: boolean; reset: number }> {
  const clientIP = getClientIP(request)

  try {
    // Use the API rate limiter (10 req/min per IP)
    const result = await checkApiRateLimit(clientIP)
    return { allowed: result.success, reset: result.reset }
  } catch (error) {
    // If rate limiting service is unavailable, allow the request but log warning
    console.warn('[API] Rate limiting service unavailable, allowing request:', error)
    return { allowed: true, reset: 0 }
  }
}

export const Route = createFileRoute('/api/events')({
  server: {
    handlers: {
      // GET /api/events - List all events
      GET: async ({ request }) => {
        // Check authentication first
        const authResult = checkAuth(request)
        if (authResult === 'not_configured') return apiKeyNotConfigured()
        if (authResult === 'unauthorized') return unauthorized()

        // Apply rate limiting
        const { allowed, reset } = await applyRateLimit(request)
        if (!allowed) return tooManyRequests(reset)

        try {
          const events = await getEventsWithVenues(1000)
          return Response.json(
            apiList(events, events.length),
            { headers: withCache({ 'Content-Type': 'application/json' }, 'short') }
          )
        } catch (error) {
          return Response.json(
            apiError(error instanceof Error ? error.message : 'Failed to fetch events', 'FETCH_ERROR'),
            { status: 500 }
          )
        }
      },

      // POST /api/events - Create a new event
      POST: async ({ request }) => {
        // Check authentication first
        const authResult = checkAuth(request)
        if (authResult === 'not_configured') return apiKeyNotConfigured()
        if (authResult === 'unauthorized') return unauthorized()

        // Apply rate limiting
        const { allowed, reset } = await applyRateLimit(request)
        if (!allowed) return tooManyRequests(reset)

        try {
          const body = await request.json()

          // Validate request body with Zod
          const parseResult = eventSubmissionSchema.safeParse(body)
          if (!parseResult.success) {
            return Response.json(
              apiError(formatZodErrors(parseResult.error), 'VALIDATION_ERROR'),
              { status: 400 }
            )
          }

          const validated = parseResult.data

          // Build event data
          const eventData: EventInsert = {
            name: validated.name,
            description_es: validated.description_es ?? null,
            description_en: validated.description_en ?? null,
            starts_at: validated.starts_at,
            ends_at: validated.ends_at ?? null,
            is_all_day: validated.is_all_day,
            venue_id: validated.venue_id ?? null,
            categories: validated.categories,
            price: validated.price ?? null,
            is_free: validated.is_free,
            image_url: validated.image_url ?? null,
            link: validated.link ?? null,
            ticket_url: validated.ticket_url ?? null,
            source: validated.source,
            status: validated.status,
          }

          // Generate embedding from event data
          const embedding = await generateEventEmbedding(eventData)

          // Create the event
          const event = await createEvent({
            ...eventData,
            embedding,
          })

          return Response.json(
            apiSuccess(event),
            { status: 201, headers: CachePresets.noStore }
          )
        } catch (error) {
          console.error('Create event error:', error)
          return Response.json(
            apiError(error instanceof Error ? error.message : 'Failed to create event', 'CREATE_ERROR'),
            { status: 500 }
          )
        }
      },
    },
  },
})
