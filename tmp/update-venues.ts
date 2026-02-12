import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

// Venues to rename
const renames = [
  { id: '7b29e363-da9f-40e3-8e0e-f5b1884c8282', oldName: 'Azcuénaga 1896', newName: 'MONS hostel' },
  { id: '5d8dde14-e722-456b-ab68-c154d03a79cc', oldName: 'José A. Cabrera 4427', newName: 'Baum Catrina' },
  { id: 'fb3fa4c3-b1b4-4c4c-8046-b8543bdd1e51', oldName: 'Víctor Hugo 1654', newName: 'Sitio Urbano Eventos' },
  { id: '1b88025f-b4c8-4b0b-944a-dbe9808ded68', oldName: 'Avenida del Libertador & República de la India', newName: 'Bosques de Palermo' },
  { id: '5ed9cc64-110b-4e24-93f4-d8a9a05497d4', oldName: 'Thames 806', newName: 'Inverso' },
  { id: '9e16e5fc-af56-493f-8f64-c700869d2e7b', oldName: 'Laprida 1212', newName: 'Museo Xul Solar' },
]

// Venues to mark as cannot_enrich
const cannotEnrich = [
  { id: '7ba952be-3368-487f-8cfb-098a453cf9d3', name: 'Cnel. Niceto Vega 5390' },
  { id: '69f145fc-560a-4466-ba79-a9af24691ab1', name: 'Bolívar 466' },
]

console.log('=== Renaming venues ===')
for (const v of renames) {
  const { error } = await supabase
    .from('venues')
    .update({ name: v.newName, address_check_status: 'confirmed_venue' })
    .eq('id', v.id)
  
  if (error) {
    console.log(`✗ ${v.oldName}: ${error.message}`)
  } else {
    console.log(`✓ ${v.oldName} → ${v.newName}`)
  }
}

console.log('\n=== Marking cannot_enrich ===')
for (const v of cannotEnrich) {
  const { error } = await supabase
    .from('venues')
    .update({ venue_enrichment_status: 'cannot_enrich' })
    .eq('id', v.id)
  
  if (error) {
    console.log(`✗ ${v.name}: ${error.message}`)
  } else {
    console.log(`✓ ${v.name} → cannot_enrich`)
  }
}

console.log('\nDone!')
process.exit(0)
