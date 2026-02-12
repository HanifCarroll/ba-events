import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Get events data from stdin
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', async () => {
  const events = JSON.parse(input);
  console.log('Processing ' + events.length + ' events...');

  let success = 0, failed = 0;
  for (const event of events) {
    try {
      const textForEmbedding = event.name + ' ' + event.description;
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: textForEmbedding,
      });
      const embedding = response.data[0].embedding;

      const { error } = await supabase.from('events').update({
        description_es: event.description,
        embedding: embedding,
        enrichment_status: 'completed',
        enriched_at: new Date().toISOString()
      }).eq('id', event.id);

      if (error) throw error;
      console.log('✓ ' + event.name.substring(0, 50));
      success++;
    } catch (e) {
      console.log('✗ ' + event.name.substring(0, 50) + ': ' + e.message);
      failed++;
    }
  }
  console.log('\nDone: ' + success + ' updated, ' + failed + ' failed');
});
