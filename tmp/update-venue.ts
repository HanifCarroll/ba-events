import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

const venueId = '5d8dde14-e722-456b-ab68-c154d03a79cc'
const { error } = await supabase
  .from('venues')
  .update({ neighborhood: 'Palermo' })
  .eq('id', venueId)

if (error) {
  console.error('Update failed:', error.message)
  process.exit(1)
}

console.log('✓ Updated José A. Cabrera 4427 → Palermo')
process.exit(0)
