import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const jsonFile = process.argv[2];
if (!jsonFile) {
  console.error('Usage: bun update-venues.mjs <json-file>');
  process.exit(1);
}

const venues = JSON.parse(readFileSync(jsonFile, 'utf-8'));
console.log(`Updating ${venues.length} venues...`);

let updated = 0;
let errors = 0;

for (const venue of venues) {
  const { error } = await supabase
    .from('venues')
    .update({
      address: venue.address,
      neighborhood: venue.neighborhood,
    })
    .eq('id', venue.id);

  if (error) {
    console.error(`Error updating ${venue.name}:`, error.message);
    errors++;
  } else {
    console.log(`✓ Updated: ${venue.name} → ${venue.address}, ${venue.neighborhood}`);
    updated++;
  }
}

console.log(`\nDone: ${updated} updated, ${errors} errors`);
