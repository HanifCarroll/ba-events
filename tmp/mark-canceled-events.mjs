import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const ids = process.argv[2]?.split(',').map(s => s.trim()).filter(Boolean);
if (!ids || ids.length === 0) {
  console.error('Usage: bun mark-canceled-events.mjs <id1,id2,...>');
  process.exit(1);
}

console.log('Marking ' + ids.length + ' events as canceled...');
for (const id of ids) {
  const { data, error } = await supabase
    .from('events')
    .update({ status: 'canceled' })
    .eq('id', id)
    .select('name, status');

  if (error) {
    console.log('✗ ' + id + ': ' + error.message);
  } else {
    console.log('✓ Marked as canceled: ' + (data[0]?.name || id));
  }
}
