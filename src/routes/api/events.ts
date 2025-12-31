import { createFileRoute } from '@tanstack/react-router'
import { createEvent, getEventsWithVenues } from '@/lib/db/client'
import { generateEventEmbedding } from '@/lib/ai/embeddings'
import type { EventInsert } from '@/lib/types'

// Simple API key auth - set ADMIN_API_KEY in your .env
const API_KEY = process.env.ADMIN_API_KEY

function unauthorized() {
  return Response.json({ error: 'Unauthorized' }, { status: 401 })
}

function checkAuth(request: Request): boolean {
  if (!API_KEY) return true // No key configured = allow all (dev mode)

  const authHeader = request.headers.get('Authorization')
  if (!authHeader) return false

  const [type, key] = authHeader.split(' ')
  return type === 'Bearer' && key === API_KEY
}

export const Route = createFileRoute('/api/events')({
  server: {
    handlers: {
      // GET /api/events - List all events
      GET: async ({ request }) => {
        if (!checkAuth(request)) return unauthorized()

        try {
          const events = await getEventsWithVenues(1000)
          return Response.json({ events, count: events.length })
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : 'Failed to fetch events' },
            { status: 500 }
          )
        }
      },

      // POST /api/events - Create a new event
      POST: async ({ request }) => {
        if (!checkAuth(request)) return unauthorized()

        try {
          const body = (await request.json()) as Partial<EventInsert>

          // Validate required fields
          if (!body.name) {
            return Response.json({ error: 'name is required' }, { status: 400 })
          }
          if (!body.starts_at) {
            return Response.json({ error: 'starts_at is required' }, { status: 400 })
          }

          // Build event data with defaults
          const eventData: EventInsert = {
            name: body.name,
            description_es: body.description_es ?? null,
            description_en: body.description_en ?? null,
            starts_at: body.starts_at,
            ends_at: body.ends_at ?? null,
            is_all_day: body.is_all_day ?? false,
            venue_id: body.venue_id ?? null,
            categories: body.categories ?? [],
            price: body.price ?? null,
            is_free: body.is_free ?? false,
            min_age: body.min_age ?? null,
            image_url: body.image_url ?? null,
            link: body.link ?? null,
            ticket_url: body.ticket_url ?? null,
            source: body.source ?? 'api',
            status: body.status ?? 'scheduled',
          }

          // Generate embedding from event data
          const embedding = await generateEventEmbedding(eventData)

          // Create the event
          const event = await createEvent({
            ...eventData,
            embedding,
          })

          return Response.json({ event }, { status: 201 })
        } catch (error) {
          console.error('Create event error:', error)
          return Response.json(
            { error: error instanceof Error ? error.message : 'Failed to create event' },
            { status: 500 }
          )
        }
      },
    },
  },
})
