import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const inputFile = process.argv[2];
if (!inputFile) {
  console.error('Usage: bun update-venue-addresses.mjs <json-file>');
  console.error('JSON file should contain: [{id, address?, neighborhood?}, ...]');
  process.exit(1);
}

const venues = JSON.parse(readFileSync(inputFile, 'utf-8'));

console.log('Updating ' + venues.length + ' venues...');
let success = 0, failed = 0;
for (const venue of venues) {
  const updateData = {};
  if (venue.address) updateData.address = venue.address;
  if (venue.neighborhood) updateData.neighborhood = venue.neighborhood;

  if (Object.keys(updateData).length === 0) {
    console.log('⏭ ' + (venue.name || venue.id) + ': nothing to update');
    continue;
  }

  const { error } = await supabase
    .from('venues')
    .update(updateData)
    .eq('id', venue.id);

  if (error) {
    console.log('✗ ' + (venue.name || venue.id) + ': ' + error.message);
    failed++;
  } else {
    console.log('✓ ' + (venue.name || venue.id));
    success++;
  }
}
console.log('\nDone: ' + success + ' updated, ' + failed + ' failed');
