/**
 * Verify Venti import results in the database.
 *
 * Run with: bun scripts/verify-venti-import.ts
 */
import { createServiceRoleClient } from '../src/trigger/utils/db-client'

async function main() {
  const client = createServiceRoleClient()

  // Count + basic stats
  const { count } = await client
    .from('events')
    .select('*', { count: 'exact', head: true })
    .eq('source', 'venti')
  console.log('total venti events:', count)

  // Field coverage checks
  const { count: withDesc } = await client
    .from('events')
    .select('*', { count: 'exact', head: true })
    .eq('source', 'venti')
    .not('description_es', 'is', null)
  console.log('with description_es:', withDesc)

  const { count: withVenue } = await client
    .from('events')
    .select('*', { count: 'exact', head: true })
    .eq('source', 'venti')
    .not('venue_id', 'is', null)
  console.log('with venue_id:', withVenue)

  const { count: withEmbedding } = await client
    .from('events')
    .select('*', { count: 'exact', head: true })
    .eq('source', 'venti')
    .not('embedding', 'is', null)
  console.log('with embedding:', withEmbedding)

  // Sample events with venue join
  const { data: samples, error } = await client
    .from('events')
    .select(
      'name, starts_at, ends_at, categories, price, is_free, image_url, link, external_id, venues(name, address)'
    )
    .eq('source', 'venti')
    .order('starts_at', { ascending: true })
    .limit(6)

  if (error) {
    console.error('query error:', error.message)
    return
  }

  console.log('\n--- sample events ---')
  for (const e of samples) {
    console.log(
      `- ${e.name.slice(0, 50)} | ${e.starts_at} | cat:${e.categories?.join(',')} | price:${e.price} free:${e.is_free} | venue:${e.venues?.[0]?.name} | ext:${e.external_id}`
    )
  }

  // Check for free/paid split and duplicate external_ids
  const { count: freeCount } = await client
    .from('events')
    .select('*', { count: 'exact', head: true })
    .eq('source', 'venti')
    .eq('is_free', true)
  console.log('\nfree events:', freeCount)

  const { data: all } = await client
    .from('events')
    .select('external_id')
    .eq('source', 'venti')
  const ids = (all ?? []).map((e: { external_id: string }) => e.external_id)
  const dupes = ids.filter((id: string, i: number) => ids.indexOf(id) !== i)
  console.log('duplicate external_ids:', dupes.length)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('failed:', error)
    process.exit(1)
  })
