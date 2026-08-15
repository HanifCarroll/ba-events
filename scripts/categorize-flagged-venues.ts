import { createClient } from '@supabase/supabase-js'

// .env is auto-loaded by Bun (dotenv removed: not a dependency in this repo; see migration evidence T1)

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  // Get all flagged venues
  const { data: venues } = await supabase
    .from('venues')
    .select('id, name, address, neighborhood')
    .eq('address_check_status', 'flagged')

  // Categorize
  const outsideBA: typeof venues = []
  const realVenues: typeof venues = []
  const needsResearch: typeof venues = []

  for (const v of venues || []) {
    const nameAddr = (v.name + ' ' + (v.address || '')).toLowerCase()

    // Virginia / outside Buenos Aires
    if (nameAddr.includes('reston') || nameAddr.includes('oakton') ||
        nameAddr.includes(', va') || nameAddr.includes('virginia') ||
        nameAddr.includes('colts neck')) {
      outsideBA.push(v)
    }
    // San Isidro / Provincia (outside CABA)
    else if (nameAddr.includes('san isidro') || nameAddr.includes('provincia de buenos aires')) {
      outsideBA.push(v)
    }
    // Plaza names are real venues
    else if (v.name.toLowerCase().startsWith('plaza ')) {
      realVenues.push(v)
    }
    // Generic Buenos Aires city reference
    else if (v.name === 'Buenos Aires, Ciudad Autónoma de Buenos Aires' ||
             v.name === 'AAC, Ciudad Autónoma de Buenos Aires') {
      outsideBA.push(v) // These are too generic, delete
    }
    else {
      needsResearch.push(v)
    }
  }

  console.log('=== CATEGORIZATION ===')
  console.log('Outside BA (delete):', outsideBA.length)
  outsideBA.forEach(v => console.log('  -', v.name))

  console.log('\nReal venue names (confirm):', realVenues.length)
  realVenues.forEach(v => console.log('  -', v.name))

  console.log('\nNeeds research:', needsResearch.length)
  needsResearch.slice(0, 20).forEach(v => console.log('  -', v.name))
  if (needsResearch.length > 20) console.log('  ... and', needsResearch.length - 20, 'more')

  console.log('\n---IDS---')
  console.log(JSON.stringify({
    outsideBA: outsideBA.map(v => v.id),
    realVenues: realVenues.map(v => v.id),
    needsResearch: needsResearch.map(v => ({ id: v.id, name: v.name }))
  }, null, 2))
}

main().catch(console.error)
