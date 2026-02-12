import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { readFileSync } from 'fs';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const inputFile = process.argv[2];
if (!inputFile) {
  console.error('Usage: bun update-event-descriptions.mjs <json-file>');
  console.error('JSON file should contain: [{id, name, description}, ...]');
  process.exit(1);
}

const events = JSON.parse(readFileSync(inputFile, 'utf-8'));

async function updateEvent(event) {
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
}

console.log('Updating ' + events.length + ' events...');
let success = 0, failed = 0;
for (const event of events) {
  try {
    await updateEvent(event);
    console.log('✓ ' + event.name.substring(0, 50));
    success++;
  } catch (e) {
    console.log('✗ ' + event.name.substring(0, 50) + ': ' + e.message);
    failed++;
  }
}
console.log('\nDone: ' + success + ' updated, ' + failed + ' failed');
