import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const ids = process.argv[2]?.split(',').map(s => s.trim()).filter(Boolean);
if (!ids || ids.length === 0) {
  console.error('Usage: bun mark-no-description.mjs <id1,id2,...>');
  process.exit(1);
}

const { data, error } = await supabase
  .from('events')
  .update({
    enrichment_status: 'failed',
    enriched_at: new Date().toISOString()
  })
  .in('id', ids)
  .select('name');

if (error) throw error;
console.log('Marked ' + data.length + ' events as failed (no description available):');
data.forEach(e => console.log('  - ' + e.name.substring(0, 50)));
