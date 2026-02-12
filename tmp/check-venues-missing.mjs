import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: venues, error } = await supabase
  .from('venues')
  .select('id, name, address, neighborhood')
  .or('address.is.null,neighborhood.is.null')
  .order('created_at', { ascending: false });

if (error) throw error;

const missingAddress = venues.filter(v => !v.address);
const missingNeighborhood = venues.filter(v => !v.neighborhood);

console.log('=== VENUES NEEDING ENRICHMENT ===\n');
console.log('Total with gaps: ' + venues.length);
console.log('Missing Address: ' + missingAddress.length);
console.log('Missing Neighborhood: ' + missingNeighborhood.length);

if (missingAddress.length > 0) {
  console.log('\n--- MISSING ADDRESS (first 15) ---');
  missingAddress.slice(0, 15).forEach((v, i) => {
    console.log((i+1) + '. ' + v.name + (v.neighborhood ? ' (' + v.neighborhood + ')' : ''));
  });
}

console.log('\n---JSON---');
console.log(JSON.stringify(venues.slice(0, 50)));
