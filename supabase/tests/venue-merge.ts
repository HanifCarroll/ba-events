/**
 * Synthetic duplicate-venue fixture for scripts/test-instagram-intake-db.sh. Prints SQL to stdout:
 *   bun supabase/tests/venue-merge.ts fixture   # venues (with non-default metadata), events, references, name-key parity
 *   bun supabase/tests/venue-merge.ts merge     # merge.sql generated from this snapshot, exactly as the script does
 *   bun supabase/tests/venue-merge.ts undo      # undo.sql, exactly as the script writes it
 * supabase/tests/venue-merge.sql checks the merged result.
 */
import { UNDO_SQL, mergeSql, planDuplicates, type VenueSnapshot } from '../../src/features/import/core/venue-duplicates.ts'
import { venueNameKey } from '../../src/features/import/core/venue-identity.ts'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const venue = (n: number, name: string, extra: Partial<VenueSnapshot['venues'][number]> = {}) => ({ id: id(n), name, address: null,
  neighborhood: null, website: null, instagram_handle: null, parent_id: null, created_at: `2026-01-${String(n).padStart(2, '0')}T00:00:00Z`,
  address_check_status: 'flagged', updated_at: '2026-02-01T00:00:00Z', ...extra })

// 1-3: one place stored three ways (doubled space, non-breaking space, suffix); 3 has the address, so it is kept.
// 4-5: a name at two different addresses, kept apart. 6: a venue whose parent is 2. 7-8: a barrio name with no address.
// 9-10: the keeper has the address, the source has the barrio, so the merge fills the keeper's enum neighborhood.
const venues = [
  venue(1, 'Sala Sintética', { website: 'https://sala.example' }),
  venue(2, 'Sala  Sintética'),
  venue(3, 'Sala\u00a0Sintética - CABA', { address: 'Calle Ficticia 100', neighborhood: 'Almagro' }),
  venue(4, 'Bar Doble', { address: 'Calle Norte 10' }),
  venue(5, 'Bar  Doble', { address: 'Calle Sur 20' }),
  venue(6, 'Sala Sintética Anexo', { parent_id: id(2) }),
  venue(7, 'San Telmo'),
  venue(8, 'San  Telmo'),
  venue(9, 'Teatro Fijo', { address: 'Calle Este 50' }),
  venue(10, 'Teatro  Fijo', { neighborhood: 'Palermo' }),
]
const events = [
  { id: id(101), venue_id: id(1), status: 'scheduled' },
  { id: id(102), venue_id: id(2), status: 'past' },
  { id: id(103), venue_id: id(2), status: 'scheduled' }, // intake-protected
  { id: id(104), venue_id: id(5), status: 'scheduled' },
  { id: id(106), venue_id: id(10), status: 'scheduled' },
]
export const snapshot: VenueSnapshot = {
  venues, events, protected_event_ids: [id(103)],
  review_queue: [{ id: id(201), best_match_venue_id: id(1), final_venue_id: id(2) }],
  dismissed: [{ id: id(301), venue_id_1: id(1), venue_id_2: id(4) }],
  intake_candidates: [{ id: id(401), venue_id: id(2) }],
  intake_revisions: [{ candidate_id: id(401), revision: 1, venue_id: id(2) }],
  intake_plans: [{ id: id(501), venue_id: id(2) }],
}

const q = (value: string | null) => value === null ? 'null' : `'${value.replace(/'/g, "''")}'`
const PARITY = ['Teatro  Ópera —', 'TEATRO\u00a0ÓPERA - Buenos Aires', 'Club 100%_Sur', 'Glück - Villa Urquiza', 'ÑANDÚ - Caba -',
  'Nobleza Obliga - Cuenta 2783 - CABA', 'Buenos Aires - Argentina', 'Café “Tortoni”', '📍 La Sala']

function fixture(): string {
  return [
    'alter table public.venues add column if not exists website text, add column if not exists instagram_handle text,',
    '  add column if not exists parent_id uuid references public.venues(id) on delete set null,',
    "  add column if not exists address_check_status text not null default 'pending', add column if not exists updated_at timestamptz not null default now();",
    // Production's venues.neighborhood is this enum (supabase/schema.sql); the shared fixture declares text.
    "create type public.neighborhood as enum ('Almagro', 'Boedo', 'Palermo', 'San Telmo');",
    'alter table public.venues alter column neighborhood type public.neighborhood using neighborhood::public.neighborhood;',
    'create function public.synthetic_venue_timestamp() returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp(); return new; end$$;',
    'create trigger venues_updated_at before update on public.venues for each row execute function public.synthetic_venue_timestamp();',
    'create table if not exists public.dismissed_venue_duplicates(id uuid primary key, venue_id_1 uuid not null references public.venues(id) on delete cascade,',
    '  venue_id_2 uuid not null references public.venues(id) on delete cascade);',
    'alter table public.event_intake_protection alter column plan_id drop not null;',
    'alter table public.event_intake_protection drop constraint if exists event_intake_protection_plan_id_fkey;',
    ...[...venues].sort((a, b) => Number(!!a.parent_id) - Number(!!b.parent_id)).map(v => `insert into public.venues(id,name,address,neighborhood,website,parent_id,created_at,address_check_status,updated_at) values(${q(v.id)},${q(v.name)},${q(v.address)},${q(v.neighborhood)},${q(v.website)},${q(v.parent_id)},${q(v.created_at)},${q(String(v.address_check_status))},${q(String(v.updated_at))});`),
    ...events.map((e, n) => `insert into public.events(id,name,starts_at,source,venue_id,status) values(${q(e.id)},'Evento ${n}',now() + interval '1 day','luma',${q(e.venue_id)},${q(e.status)});`),
    `insert into public.event_intake_protection(event_id, fields, authority, observed_at) values(${q(id(103))}, array['venue_id','name'], 2, now());`,
    `insert into public.venue_review_queue(id,source,source_venue_name,best_match_venue_id,final_venue_id) values(${q(id(201))},'luma','Sala',${q(id(1))},${q(id(2))});`,
    `insert into public.dismissed_venue_duplicates values(${q(id(301))},${q(id(1))},${q(id(4))});`,
    `insert into public.intake_candidates(id,revision,payload) values(${q(id(401))},1,jsonb_build_object('venue_id',${q(id(2))},'name','Evento'));`,
    `insert into public.intake_candidate_revisions(candidate_id,revision,payload) values(${q(id(401))},1,jsonb_build_object('venue_id',${q(id(2))}));`,
    `insert into public.intake_plans(id,candidate_id,revision,action,event_id,payload,evidence,reasons) values(${q(id(501))},${q(id(401))},1,'create',${q(id(103))},jsonb_build_object('venue_id',${q(id(2))}),'[]','[]');`,
    'do $$ begin',
    ...PARITY.map(name => `  if public.venue_name_key(${q(name)}) is distinct from ${q(venueNameKey(name))} then raise exception 'venue_name_key differs from venueNameKey for %', ${q(name)}; end if;`),
    'end $$;',
  ].join('\n')
}

// Also imported by venue-duplicates.test.ts for the same snapshot, so only print when run directly.
if (import.meta.main) {
  const mode = process.argv[2]
  if (mode === 'fixture') console.log(fixture())
  else if (mode === 'merge') console.log(mergeSql(planDuplicates(snapshot)))
  else if (mode === 'undo') console.log(UNDO_SQL)
  else { console.error('Usage: bun supabase/tests/venue-merge.ts fixture | merge | undo'); process.exit(2) }
}
