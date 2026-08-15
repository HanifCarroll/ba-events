import { createClient } from '@supabase/supabase-js'

// .env is auto-loaded by Bun (dotenv removed: not a dependency in this repo; see migration evidence T1)

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  // Get all Passline events
  const { data, error } = await supabase
    .from('events')
    .select('id, name, status, description_es, description_unavailable')
    .eq('source', 'passline')

  if (error) {
    console.log('Error:', error.message)
    process.exit(1)
  }

  // Categorize
  const withDesc = data.filter(e => e.description_es && e.description_es.length > 0)
  const markedUnavailable = data.filter(e => e.description_unavailable === true)
  const pastNoDesc = data.filter(e =>
    e.status === 'past' &&
    (!e.description_es || e.description_es.length === 0) &&
    !e.description_unavailable
  )
  const upcomingNoDesc = data.filter(e =>
    e.status !== 'past' &&
    (!e.description_es || e.description_es.length === 0) &&
    !e.description_unavailable
  )

  console.log('=== Passline Events Status ===')
  console.log(`Total: ${data.length}`)
  console.log(`With description: ${withDesc.length}`)
  console.log(`Marked unavailable: ${markedUnavailable.length}`)
  console.log(`Past, no desc, needs marking: ${pastNoDesc.length}`)
  console.log(`Upcoming, no desc, needs enrichment: ${upcomingNoDesc.length}`)

  if (pastNoDesc.length > 0) {
    console.log('\nSample past events needing marking:')
    pastNoDesc.slice(0, 5).forEach(e => console.log(`  - ${e.name}`))
  }
}

main()
