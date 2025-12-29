import { createFileRoute } from '@tanstack/react-router'
import { runPasslineAutoImport } from '@/lib/admin'

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

        // Verify API key against environment variable
        if (apiKey !== process.env.SCRAPER_API_KEY) {
          return Response.json(
            { error: 'Unauthorized' },
            { status: 401 }
          )
        }

        try {
          const result = await runPasslineAutoImport()
          return Response.json(result)
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          console.error('Passline import error:', error)
          return Response.json({ error: message }, { status: 500 })
        }
      },
    },
  },
})
