import { createClient } from '@supabase/supabase-js'

// .env is auto-loaded by Bun (dotenv removed: not a dependency in this repo; see migration evidence T1)

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  const { data, error } = await supabase
    .from('events')
    .select('id, name, link')
    .eq('source', 'passline')
    .eq('description_unavailable', true)
    .neq('status', 'past')
    .not('link', 'is', null)
    .order('starts_at', { ascending: true })

  if (error) {
    console.log('Error:', error.message)
    process.exit(1)
  }

  console.log('Found ' + data.length + ' events to re-process')
  console.log('\nFirst 10:')
  data.slice(0, 10).forEach((e, i) => {
    console.log((i + 1) + '. ' + e.name.substring(0, 50))
  })

  console.log('\n---JSON---')
  console.log(JSON.stringify(data))
}

main()
