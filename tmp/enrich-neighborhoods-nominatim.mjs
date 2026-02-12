import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const limit = parseInt(process.argv[2] || '20');

// Nominatim rate limit: 1 req/sec
const delay = (ms) => new Promise(r => setTimeout(r, ms));

async function geocodeAddress(address) {
  const query = encodeURIComponent(address + ', Buenos Aires, Argentina');
  const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&addressdetails=1&limit=1`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'BA-Events-Pipeline/1.0' }
  });

  if (!res.ok) return null;
  const data = await res.json();
  if (!data.length) return null;

  const addr = data[0].address;
  // Nominatim returns suburb/neighbourhood for CABA barrios
  return addr.suburb || addr.neighbourhood || addr.city_district || null;
}

// Map common Nominatim variations to official names
const NEIGHBORHOOD_MAP = {
  'palermo viejo': 'Palermo',
  'palermo soho': 'Palermo',
  'palermo hollywood': 'Palermo',
  'villa crespo': 'Villa Crespo',
  'almagro': 'Almagro',
  'san telmo': 'San Telmo',
  'san nicolás': 'San Nicolas',
  'san nicolas': 'San Nicolas',
  'san cristóbal': 'San Cristobal',
  'san cristobal': 'San Cristobal',
  'monserrat': 'Monserrat',
  'puerto madero': 'Puerto Madero',
  'recoleta': 'Recoleta',
  'belgrano': 'Belgrano',
  'núñez': 'Nunez',
  'nuñez': 'Nunez',
  'colegiales': 'Colegiales',
  'chacarita': 'Chacarita',
  'caballito': 'Caballito',
  'flores': 'Flores',
  'floresta': 'Floresta',
  'balvanera': 'Balvanera',
  'boedo': 'Boedo',
  'barracas': 'Barracas',
  'la boca': 'La Boca',
  'constitución': 'Constitucion',
  'constitucion': 'Constitucion',
  'retiro': 'Retiro',
  'villa urquiza': 'Villa Urquiza',
  'villa devoto': 'Villa Devoto',
  'liniers': 'Liniers',
  'mataderos': 'Mataderos',
  'parque patricios': 'Parque Patricios',
  'parque chacabuco': 'Parque Chacabuco',
};

function normalizeNeighborhood(raw) {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  return NEIGHBORHOOD_MAP[lower] || raw;
}

async function main() {
  // Get venues with address but no neighborhood
  const { data: venues, error } = await supabase
    .from('venues')
    .select('id, name, address, neighborhood')
    .not('address', 'is', null)
    .is('neighborhood', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  if (!venues.length) {
    console.log('No venues with address but missing neighborhood.');
    return;
  }

  console.log(`Found ${venues.length} venues with address but no neighborhood:\n`);

  let success = 0, failed = 0;
  const results = [];

  for (let i = 0; i < venues.length; i++) {
    const v = venues[i];
    console.log(`[${i + 1}/${venues.length}] ${v.name}`);
    console.log(`  Address: ${v.address}`);

    const rawNeighborhood = await geocodeAddress(v.address);
    const neighborhood = normalizeNeighborhood(rawNeighborhood);

    if (neighborhood) {
      const { error: updateError } = await supabase
        .from('venues')
        .update({ neighborhood })
        .eq('id', v.id);

      if (updateError) {
        console.log(`  ✗ Update failed: ${updateError.message}`);
        failed++;
      } else {
        console.log(`  ✓ ${neighborhood}`);
        success++;
        results.push({ id: v.id, name: v.name, neighborhood });
      }
    } else {
      console.log(`  ✗ No neighborhood found`);
      failed++;
    }

    // Rate limit
    if (i < venues.length - 1) {
      await delay(1100);
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Updated: ${success}`);
  console.log(`Failed: ${failed}`);

  if (results.length > 0) {
    console.log(`\n---JSON---`);
    console.log(JSON.stringify(results));
  }
}

main().catch(console.error);
