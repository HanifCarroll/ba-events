import { createClient } from '@supabase/supabase-js'

// .env is auto-loaded by Bun (dotenv removed: not a dependency in this repo; see migration evidence T1)

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  const { data, error } = await supabase
    .from('events')
    .select('id, name, link')
    .eq('source', 'passline')
    .neq('status', 'past')
    .neq('description_unavailable', true)
    .not('link', 'is', null)
    .order('starts_at', { ascending: true })

  if (error) {
    console.log('Error:', error.message)
    process.exit(1)
  }

  // Filter to those without description
  const { data: withDesc } = await supabase
    .from('events')
    .select('id')
    .eq('source', 'passline')
    .neq('status', 'past')
    .not('description_es', 'is', null)

  const withDescIds = new Set(withDesc?.map(e => e.id) || [])
  const toEnrich = data.filter(e => !withDescIds.has(e.id) && e.link)

  console.log('Found ' + toEnrich.length + ' events to enrich')
  console.log('\nFirst 10:')
  toEnrich.slice(0, 10).forEach((e, i) => {
    console.log((i + 1) + '. ' + e.name.substring(0, 50))
  })

  console.log('\n---JSON---')
  console.log(JSON.stringify(toEnrich))
}

main()
