import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

// Venues that cannot be enriched (researched but no specific address exists)
const venuesToMark = [
  {
    id: 'bbda790c-d51b-4bb6-9475-afdba790b1b2',
    name: 'Terraza en Palermo',
    reason: 'Generic rooftop location, no specific address available'
  },
  {
    id: '3996a3f6-9e83-4086-9730-7fd32449c804',
    name: 'Puerto Madero',
    reason: 'Neighborhood used as venue name, no specific address'
  },
  {
    id: 'aa28418c-a036-4b3d-95c1-033865ec33a4',
    name: 'Salón Norma Lew',
    reason: 'Private venue, address not publicly available'
  }
]

async function main() {
  for (const venue of venuesToMark) {
    const { error } = await supabase
      .from('venues')
      .update({
        venue_enrichment_status: 'cannot_enrich'
      })
      .eq('id', venue.id)

    if (error) {
      console.error(`Failed to update ${venue.name}:`, error.message)
    } else {
      console.log(`Marked as cannot_enrich: ${venue.name}`)
      console.log(`  Reason: ${venue.reason}`)
    }
  }
}

main().catch(console.error)
