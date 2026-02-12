import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function main() {
  const limit = parseInt(process.argv[2] || '10')

  const { data, error } = await supabase
    .from('venues')
    .select('id, name, address, neighborhood, venue_enrichment_status')
    .or('address.is.null,neighborhood.is.null')
    .neq('venue_enrichment_status', 'cannot_enrich')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('Error:', error.message)
    process.exit(1)
  }

  if (!data || data.length === 0) {
    console.log('No venues found missing address or neighborhood!')
    return
  }

  console.log(`Found ${data.length} venues needing enrichment:\n`)
  data.forEach((v, i) => {
    console.log(`${i + 1}. ${v.name}`)
    console.log(`   Address: ${v.address || 'MISSING'}`)
    console.log(`   Neighborhood: ${v.neighborhood || 'MISSING'}`)
  })
  console.log('\n---JSON---')
  console.log(JSON.stringify(data))
}

main().catch(console.error)
