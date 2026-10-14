import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { lexicalEventSearch, semanticEventSearch } from './client.server.ts'

describe('actual search RPC free/paid filters', () => {
  for (const kind of ['semantic', 'lexical'] as const) {
    for (const isFree of [false, true, undefined]) {
      it(`${kind} preserves ${String(isFree)} on the serialized request and matching results`, async () => {
        const bodies: Array<Record<string, unknown>> = []
        const client = createClient('https://database.example.test', 'test-only-key', {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { fetch: async (_url, init) => {
            const body = JSON.parse(String(init?.body))
            bodies.push(body)
            const events = body.filter_is_free === false ? [{ id: 'paid' }]
              : body.filter_is_free === true ? [{ id: 'free' }] : [{ id: 'paid' }, { id: 'free' }]
            return Response.json(events)
          } },
        })
        const filters = { isFree, maxPrice: 0, minAge: 0 }
        const results = kind === 'semantic'
          ? await semanticEventSearch('event', filters, 50, undefined, { client, embedQuery: async () => [0.1] })
          : await lexicalEventSearch('event', filters, 50, undefined, { client })
        expect(bodies).toHaveLength(1)
        expect(bodies[0]).toMatchObject({ filter_is_free: isFree ?? null, filter_max_price: 0, filter_min_age: 0 })
        expect(results.map(event => event.id)).toEqual(isFree === false ? ['paid'] : isFree === true ? ['free'] : ['paid', 'free'])
      })
    }
  }
})
