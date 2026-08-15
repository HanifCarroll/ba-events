import { createClient } from '@supabase/supabase-js'

// .env is auto-loaded by Bun (dotenv removed: not a dependency in this repo; see migration evidence T1)

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  const { data: venues, error } = await supabase
    .from('venues')
    .select('name, address, created_at')
    .or('address.ilike.%VA%,address.ilike.%Reston%,address.ilike.%Sterling%,address.ilike.%McLean%,address.ilike.%Oakton%')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error:', error)
    process.exit(1)
  }

  console.table(venues)
  process.exit(0)
}

main()
