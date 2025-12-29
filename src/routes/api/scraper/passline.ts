import { createFileRoute } from '@tanstack/react-router'
import { autoImportPasslineEventsAction } from '@/lib/admin'

export const Route = createFileRoute('/api/scraper/passline')({
  server: {
    handlers: {
      // POST /api/scraper/passline - Run automated Passline import
      POST: async ({ request }) => {
        const apiKey = request.headers.get('x-api-key')

        if (!apiKey) {
          return Response.json(
            { error: 'Missing API key' },
            { status: 401 }
          )
        }

        try {
          const result = await autoImportPasslineEventsAction({
            data: { apiKey },
          })

          return Response.json(result)
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          const status = message === 'Unauthorized' ? 401 : 500

          return Response.json({ error: message }, { status })
        }
      },
    },
  },
})
