/**
 * Public Events API
 *
 * GET  /api/events — list events (admin API key, cached).
 * POST /api/events — create an event (admin API key, embedding + presentation).
 */

import type { RequestEvent } from '@sveltejs/kit'
import { Schema, SchemaIssue } from 'effect'
import { createEvent, getEventsWithVenues } from '#shared/lib/db/client.server.ts'
import {
  embedEventWithDocument,
  CURRENT_EMBEDDING_VERSION,
} from '#shared/lib/ai/embeddings.ts'
import { buildDescriptionPresentationFields } from '#features/events/lib/description-presentation.server.ts'
import { checkApiRateLimit, RATE_LIMIT_RETRY_SECONDS } from '#features/auth/api/rate-limit.server.ts'
import { apiSuccess, apiList, apiError, CachePresets, withCache } from '#shared/lib/api-response.ts'
import { CATEGORIES, EVENT_STATUSES } from '#shared/lib/types.ts'
import type { EventInsert } from '#shared/lib/types.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isoDate = (requiredMessage: string, invalidMessage: string) => Schema.String.pipe(
	Schema.check(Schema.isMinLength(1, { message: requiredMessage })),
	Schema.refine((value): value is string => !Number.isNaN(Date.parse(value)), { message: invalidMessage })
)
const validDate = (message: string) => Schema.String.pipe(
	Schema.refine((value): value is string => !Number.isNaN(Date.parse(value)), { message })
)
const eventName = Schema.String.pipe(
	Schema.check(Schema.isMinLength(1, { message: 'name is required' })),
	Schema.check(Schema.isMaxLength(255, { message: 'name must be 255 characters or less' })),
	Schema.annotateKey({ messageMissingKey: 'name is required' })
)
const venueId = Schema.String.pipe(
	Schema.refine((value): value is string => UUID_RE.test(value), { message: 'venue_id must be a valid UUID' })
)
const url = (message: string) => Schema.String.pipe(
	Schema.refine((value): value is string => {
		try { new URL(value); return true } catch { return false }
	}, { message })
)

// Effect Schema validates this repository-owned request body. The AI SDK and
// MCP SDK schemas remain third-party-owned Zod contracts elsewhere.
const eventSubmissionSchema = Schema.Struct({
  // Required fields
  name: eventName,
  starts_at: isoDate('starts_at is required', 'starts_at must be a valid ISO date string').pipe(
	  Schema.annotateKey({ messageMissingKey: 'starts_at is required' })
	),

  // Optional fields
  description_es: Schema.optional(Schema.NullOr(Schema.String)),
  description_en: Schema.optional(Schema.NullOr(Schema.String)),
  description_display_es: Schema.optional(Schema.NullOr(Schema.String)),
  description_display_en: Schema.optional(Schema.NullOr(Schema.String)),
  description_summary_es: Schema.optional(Schema.NullOr(Schema.String)),
  description_summary_en: Schema.optional(Schema.NullOr(Schema.String)),
  ends_at: Schema.optional(Schema.NullOr(validDate('ends_at must be a valid ISO date string'))),
  is_all_day: Schema.optional(Schema.Boolean),
  venue_id: Schema.optional(Schema.NullOr(venueId)),
  categories: Schema.optional(Schema.Array(Schema.Literals(CATEGORIES))),
  price: Schema.optional(Schema.NullOr(Schema.Number.pipe(
	Schema.check(Schema.isGreaterThanOrEqualTo(0, { message: 'price must be a positive number' }))
  ))),
  is_free: Schema.optional(Schema.Boolean),
  image_url: Schema.optional(Schema.NullOr(url('image_url must be a valid URL'))),
  link: Schema.optional(Schema.NullOr(url('link must be a valid URL'))),
  ticket_url: Schema.optional(Schema.NullOr(url('ticket_url must be a valid URL'))),
  source: Schema.optional(Schema.String),
  external_id: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(Schema.Literals(EVENT_STATUSES)),
})

function formatSchemaErrors(issue: SchemaIssue.Issue): string {
	return SchemaIssue.makeFormatterStandardSchemaV1()(issue).issues
		.map((entry) => `${entry.path?.join('.') ?? ''}: ${entry.message}`)
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

function limiterUnavailable(): Response {
  return Response.json(apiError('Rate limiting is temporarily unavailable.', 'SERVICE_UNAVAILABLE'), {
    status: 503, headers: { 'Retry-After': String(RATE_LIMIT_RETRY_SECONDS) },
  })
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

function getClientIP(event: RequestEvent): string {
  // Canonical SvelteKit address (set by the adapter, trusted when configured
  // to honor proxy headers).
  const clientAddress = event.getClientAddress()
  if (clientAddress) return clientAddress

  // Legacy fallback chain, preserved in its original order of preference.
  const forwardedFor = event.request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    // x-forwarded-for can contain multiple IPs, take the first one
    return forwardedFor.split(',')[0].trim()
  }

  const realIP = event.request.headers.get('x-real-ip')
  if (realIP) {
    return realIP
  }

  // Fallback to a default identifier
  return 'unknown-ip'
}

async function applyRateLimit(event: RequestEvent): Promise<{ allowed: boolean; reset: number; unavailable?: boolean }> {
  const clientIP = getClientIP(event)

  try {
    // Use the API rate limiter (10 req/min per IP)
    const result = await checkApiRateLimit(clientIP)
    return { allowed: result.success, reset: result.reset }
  } catch {
    return { allowed: false, reset: 0, unavailable: true }
  }
}

// GET /api/events - List all events
export const GET = async (event: RequestEvent): Promise<Response> => {
  const { request } = event

  // Check authentication first
  const authResult = checkAuth(request)
  if (authResult === 'not_configured') return apiKeyNotConfigured()
  if (authResult === 'unauthorized') return unauthorized()

  // Apply rate limiting
  const { allowed, reset, unavailable } = await applyRateLimit(event)
  if (unavailable) return limiterUnavailable()
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
}

// POST /api/events - Create a new event
export const POST = async (event: RequestEvent): Promise<Response> => {
  const { request } = event

  // Check authentication first
  const authResult = checkAuth(request)
  if (authResult === 'not_configured') return apiKeyNotConfigured()
  if (authResult === 'unauthorized') return unauthorized()

  // Apply rate limiting
  const { allowed, reset, unavailable } = await applyRateLimit(event)
  if (unavailable) return limiterUnavailable()
  if (!allowed) return tooManyRequests(reset)

  try {
    const body = await request.json()

    const parseResult = Schema.decodeUnknownResult(eventSubmissionSchema)(body)
    if (parseResult._tag !== 'Success') {
      return Response.json(
        apiError(formatSchemaErrors(parseResult.failure.issue), 'VALIDATION_ERROR'),
        { status: 400 }
      )
    }

    const validated = parseResult.success

    // Build event data
    const eventData: EventInsert = {
      name: validated.name,
      description_es: validated.description_es ?? null,
      description_en: validated.description_en ?? null,
      starts_at: validated.starts_at,
      ends_at: validated.ends_at ?? null,
      is_all_day: validated.is_all_day ?? false,
      venue_id: validated.venue_id ?? null,
      categories: validated.categories ? [...validated.categories] : [],
      price: validated.price ?? null,
      is_free: validated.is_free ?? false,
      image_url: validated.image_url ?? null,
      link: validated.link ?? null,
      ticket_url: validated.ticket_url ?? null,
      source: validated.source ?? 'api',
      status: validated.status ?? 'scheduled',
    }

    // Generate embedding + search document together (they must not drift)
    const { embedding, searchDocument } = await embedEventWithDocument(eventData)
    const presentationFields = await buildDescriptionPresentationFields({
      description_es: eventData.description_es,
      description_en: eventData.description_en,
    })

    // Create the event
    const event = await createEvent({
      ...eventData,
      ...presentationFields,
      embedding,
      search_document: searchDocument,
      embedding_version: CURRENT_EMBEDDING_VERSION,
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
}
