import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env' })

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  console.log('Updating venues with found information...\n')

  // Update Huella Negra - Mozart 250 is in Villa Luro
  const { error: error1 } = await supabase
    .from('venues')
    .update({
      address: 'Mozart 250',
      neighborhood: 'Villa Luro'
    })
    .ilike('name', '%Huella Negra%')

  if (error1) {
    console.error('Error updating Huella Negra:', error1.message)
  } else {
    console.log('✓ Updated Huella Negra: Mozart 250, Villa Luro')
    console.log('  Instagram: https://www.instagram.com/lahuellanegra/')
  }

  // Update Cultural CAVA - Pavón 3939 is in Boedo
  const { error: error2 } = await supabase
    .from('venues')
    .update({
      address: 'Pavón 3939',
      neighborhood: 'Boedo'
    })
    .ilike('name', '%Cultural CAVA%')

  if (error2) {
    console.error('Error updating Cultural CAVA:', error2.message)
  } else {
    console.log('✓ Updated Cultural CAVA: Pavón 3939, Boedo')
    console.log('  Instagram: https://www.instagram.com/culturalcava/')
  }

  process.exit(0)
}

main()
