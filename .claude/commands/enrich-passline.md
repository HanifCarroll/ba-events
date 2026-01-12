---
description: Extract descriptions from Passline event pages and update the database
allowed-tools: Bash, Read, Grep, mcp__playwriter__*, TodoWrite
argument-hint: [limit] (optional, default 20)
---

# Passline Description Enrichment

Extract event descriptions from Passline.com pages for events missing descriptions in the database.

## Prerequisites

- Chrome browser must be open with the Playwriter extension active
- User should click the Playwriter extension icon on any tab to activate MCP connection

## Process

### 1. Find Events Needing Enrichment

Query the database for Passline events without descriptions:

```bash
bun -e "
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data, error } = await supabase.from('events')
    .select('id, name, link')
    .eq('source', 'passline')
    .neq('status', 'past')
    .is('description_es', null)
    .not('link', 'is', null)
    .limit($ARGUMENTS || 20);

  if (error) throw error;
  console.log('Found', data.length, 'events needing descriptions:');
  data.forEach((e, i) => console.log((i+1) + '.', e.name.substring(0, 60)));
  console.log('---JSON---');
  console.log(JSON.stringify(data));
}
main().catch(console.error);
"
```

### 2. Extract Descriptions with Playwriter

Use Playwriter to efficiently extract descriptions from multiple pages:

```javascript
// Store events in state
state.events = [ /* array of {id, name, link} from DB query */ ];
state.results = [];

// Extract descriptions in batches of 5
for (let i = 0; i < state.events.length; i++) {
  const e = state.events[i];
  await page.goto(e.link);
  await page.waitForLoadState('domcontentloaded');
  const desc = await page.evaluate(() => {
    try {
      const ld = document.querySelector('script[type="application/ld+json"]');
      return ld ? JSON.parse(ld.textContent).description : null;
    } catch(e) { return null; }
  });
  state.results.push({id: e.id, name: e.name, description: desc});
  console.log((i+1) + '.', e.name.substring(0, 40), ':', desc ? 'GOT' : 'NO DESC');
}
```

### 3. Update Database

**CRITICAL: Use `SUPABASE_SERVICE_ROLE_KEY` not anon key - RLS blocks writes with anon key.**

Create a script with the extracted data and run it:

```bash
cat << 'SCRIPT' > /tmp/update-events.mjs
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const events = [
  // Paste events with descriptions here as {id, name, description} objects
];

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
  return true;
}

async function main() {
  console.log('Updating', events.length, 'events...');
  let success = 0, failed = 0;
  for (const event of events) {
    try {
      await updateEvent(event);
      console.log('✓', event.name.substring(0, 50));
      success++;
    } catch (e) {
      console.log('✗', event.name.substring(0, 50), e.message);
      failed++;
    }
  }
  console.log('Done:', success, 'updated,', failed, 'failed');
}

main();
SCRIPT
bun /tmp/update-events.mjs
```

### 4. Handle Recurring Events

If multiple events have the same name pattern (e.g., "Hamburguesas libres..."), extract description once and apply to all matching events to save time.

### 5. Report Results

After completion, report:
- Number of events successfully enriched
- Any events that failed (with reasons)
- Remaining events without descriptions

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "No browser tabs connected" | User needs to click Playwriter extension icon on a tab |
| JSON-LD empty/malformed | Page has no description - skip and note in report |
| RLS error on update | Verify using `SUPABASE_SERVICE_ROLE_KEY` not anon key |
| Cloudflare challenge | Wait longer, or ask user to manually solve CAPTCHA |
| Connection lost | Call `mcp__playwriter__reset` to reconnect |

## Example Workflow

```
User: /enrich-passline 10

Claude:
1. Queries DB -> finds 10 events
2. Stores events in playwriter state
3. Loops through events extracting descriptions (batches of 5)
4. Creates update script with events that have descriptions
5. Runs script to update DB with descriptions + embeddings
6. Reports: "Updated 8 events. 2 had no description. 132 remaining."
```
