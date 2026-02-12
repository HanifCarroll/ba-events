import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env' })

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  // Find past Passline events without descriptions that aren't already marked
  const { data: toMark, error: findError } = await supabase
    .from('events')
    .select('id, name, description_es, description_unavailable')
    .eq('source', 'passline')
    .eq('status', 'past')
    .is('description_unavailable', null)

  if (findError) {
    console.log('Error:', findError.message)
    process.exit(1)
  }

  // Filter to only those without descriptions
  const needsMarking = toMark.filter(e => !e.description_es || e.description_es.length === 0)

  console.log(`Found ${needsMarking.length} past Passline events to mark as description_unavailable`)

  if (needsMarking.length === 0) {
    console.log('Nothing to update.')
    process.exit(0)
  }

  // Update them
  const ids = needsMarking.map(e => e.id)
  const { error: updateError } = await supabase
    .from('events')
    .update({ description_unavailable: true })
    .in('id', ids)

  if (updateError) {
    console.log('Update error:', updateError.message)
    process.exit(1)
  }

  console.log(`✓ Marked ${needsMarking.length} past events as description_unavailable`)
}

main()
