import { createClient } from '@supabase/supabase-js'

// .env is auto-loaded by Bun (dotenv removed: not a dependency in this repo; see migration evidence T1)

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  console.log('Updating Escuela de Enfermeria...\n')

  // Update with full address and neighborhood
  const { error } = await supabase
    .from('venues')
    .update({
      address: 'Av. Rivadavia 454',
      neighborhood: 'Monserrat'
    })
    .ilike('name', '%Escuela de Enfermeria%')

  if (error) {
    console.error('Error:', error.message)
  } else {
    console.log('✓ Updated Escuela de Enfermeria with address and neighborhood')
  }

  process.exit(0)
}

main()
