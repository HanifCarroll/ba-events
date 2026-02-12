import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const limit = parseInt(process.argv[2] || '20');

const { data, error } = await supabase.from('events')
  .select('id, name, link')
  .eq('source', 'passline')
  .neq('status', 'past')
  .is('description_es', null)
  .not('link', 'is', null)
  .or('enrichment_status.is.null,enrichment_status.eq.pending')
  .limit(limit);

if (error) throw error;

console.log('Found ' + data.length + ' Passline events needing descriptions:\n');
data.forEach((e, i) => console.log((i+1) + '. ' + e.name.substring(0, 60)));
console.log('\n---JSON---');
console.log(JSON.stringify(data));
