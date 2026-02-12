import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  // Get flagged venues ordered by most recently created
  const { data: venues, error: venueError } = await supabase
    .from('venues')
    .select('id, name, address, neighborhood, created_at')
    .eq('address_check_status', 'flagged')
    .order('created_at', { ascending: false });

  if (venueError) throw venueError;
  if (!venues?.length) {
    console.log('No flagged venues to process');
    console.log('\n---JSON---');
    console.log('[]');
    return;
  }

  // Get events for these venues
  const { data: events, error: eventError } = await supabase
    .from('events')
    .select('id, name, venue_id, link, source')
    .in('venue_id', venues.map(v => v.id));

  if (eventError) throw eventError;

  // Group events by venue
  const eventsByVenue = new Map();
  for (const event of events || []) {
    const list = eventsByVenue.get(event.venue_id) || [];
    list.push(event);
    eventsByVenue.set(event.venue_id, list);
  }

  // Build output
  const output = venues.map(v => ({
    id: v.id,
    name: v.name,
    address: v.address,
    neighborhood: v.neighborhood,
    created_at: v.created_at,
    events: (eventsByVenue.get(v.id) || []).map(e => ({
      id: e.id,
      name: e.name,
      source: e.source,
      link: e.link,
    }))
  }));

  console.log(`Found ${venues.length} flagged venues:\n`);
  for (const v of output) {
    console.log(`- ${v.name}`);
    console.log(`  Events: ${v.events.length}`);
    if (v.events.length > 0) {
      console.log(`  Sources: ${[...new Set(v.events.map(e => e.source))].join(', ')}`);
    }
  }

  console.log('\n---JSON---');
  console.log(JSON.stringify(output, null, 2));
}

main().catch(console.error);
