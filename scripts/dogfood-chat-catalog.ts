import { freshD1 } from '../tests/support/d1.ts'

/** Local synthetic catalog for chat transport dogfood, not a Vectorize relevance test. */
export async function openDogfoodCatalog(now = new Date()) {
  const { db: DB, dispose } = await freshD1()
  const days = [1, 2, 3, 4, 5, 6]
  const ids = days.map(day => `00000000-0000-4000-8000-00000000000${day}`)
  const description = 'Música en vivo en Palermo, Buenos Aires.'
  try {
    await DB.prepare("INSERT INTO venues (id, name, neighborhood) VALUES ('dogfood-venue', 'Sala de prueba', 'Palermo')").run()
    await DB.batch(days.map((day, index) => {
      const startsAt = new Date(now)
      startsAt.setUTCHours(22, 0, 0, 0)
      startsAt.setUTCDate(startsAt.getUTCDate() + day)
      return DB.prepare(`INSERT INTO events (id, name, starts_at, description_es, description_display_es,
        search_document, is_free, venue_id, source, scope) VALUES (?, ?, ?, ?, ?, ?, 1, 'dogfood-venue', 'dogfood', 'in')`)
        .bind(ids[index], `Concierto de prueba ${day}`, startsAt.toISOString(), description, description, description)
    }))
    let queryVector: number[] = []
    const VECTORIZE = {
      query: async (embedding: number[]) => {
        queryVector = embedding
        return { matches: ids.map(id => ({ id, score: 1 })), count: ids.length }
      },
      // Echo the query vector so the fixture exercises D1 hydration without a hosted index.
      getByIds: async (requested: string[]) => requested.filter(id => ids.includes(id))
        .map(id => ({ id, values: queryVector })),
    }
    return { env: { DB, VECTORIZE }, dispose }
  } catch (error) {
    await dispose()
    throw error
  }
}
