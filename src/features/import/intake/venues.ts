/** Operator venue resolution for the Instagram intake: dedupe, check the city and neighborhood, create, keep evidence. */
import { Effect, Schema } from 'effect'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createVenue } from '#shared/lib/db/client.server.ts'
import { createVenueSchema } from '#shared/lib/schemas.ts'
import { NEIGHBORHOODS, type Neighborhood, type Venue } from '#shared/lib/types.ts'
import { importTry, ImportOperationError } from '../core/effect-utils.ts'
import { mapNominatimNeighborhood, searchNominatimEffect, type NominatimResult } from '../core/nominatim.ts'
import { AUTO_USE_THRESHOLD, REVIEW_QUEUE_THRESHOLD, isGarbageVenueName, isPlaceholderVenue } from '../core/venue-settlement.ts'
import { validPublicUrl, type Candidate } from './schema.ts'
import { baDate, normalizeTitle } from './planning.ts'
import { allRowsEffect, dbEffect } from './repository.ts'

const text = (min: number, max: number) => Schema.String.pipe(Schema.check(Schema.isMinLength(min), Schema.isMaxLength(max)))
export const VenueRequestSchema = Schema.Struct({
  name: text(3, 150),
  address: text(3, 300),
  neighborhood: Schema.optional(Schema.NullOr(text(3, 80))),
  website: Schema.optional(Schema.NullOr(text(1, 2048))),
  instagram_handle: Schema.optional(Schema.NullOr(Schema.String.pipe(Schema.check(Schema.isPattern(/^@?[A-Za-z0-9_.]{1,30}$/))))),
  evidence: Schema.Array(Schema.Struct({ url: text(1, 2048), confirms: text(3, 1000) }))
    .pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(20))),
})
export type VenueRequest = typeof VenueRequestSchema.Type
type VenueRow = Pick<Venue, 'id' | 'name' | 'address' | 'neighborhood'>
export type VenueOutcome =
  | { outcome: 'existing'; venue: VenueRow; match: string; completed?: string[]; warnings?: string[] }
  | { outcome: 'created'; venue: VenueRow; warnings: string[] }
  | { outcome: 'ambiguous'; candidates: Array<VenueRow & { why: string }> }
  | { outcome: 'rejected'; reasons: string[] }
export type Geocode = (query: string) => Effect.Effect<NominatimResult | null, unknown>

export const INTAKE_VENUE_SOURCE = 'instagram-intake'
const CITY_STATE = 'ciudad autonoma de buenos aires'
const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const failure = (message: string) => new ImportOperationError({ operation: 'intake.venue', message })

/** "Av. Corrientes 1530, CABA" and "Avenida Corrientes 1530" share the key "corrientes 1530". Null without a street number. */
export function addressKey(address: string | null | undefined): string | null {
  if (!address) return null
  const key = fold(address.split(',')[0]).replace(/[.#°º]/g, ' ')
    .replace(/^\s*(avenida|avda|av|calle|pasaje|pje)\s+/, '').replace(/\s+/g, ' ').trim()
  return /\d/.test(key) ? key : null
}

export function decodeVenueRequest(input: unknown): VenueRequest {
  const request = Schema.decodeUnknownSync(VenueRequestSchema, { onExcessProperty: 'error' })(input)
  if (request.evidence.some(item => !validPublicUrl(item.url))) throw new Error('Each evidence URL must be a public HTTPS address')
  return request
}

/**
 * Same name (case-insensitive, or trigram similarity at the importers' auto-use threshold) and a compatible address returns the existing venue,
 * which also makes a repeated request idempotent. Review-band names, or another venue at the same address, are ambiguous.
 */
export const resolveIntakeVenueEffect = Effect.fn('intake.venue')(function*(client: SupabaseClient, request: VenueRequest,
  geocode: Geocode = query => searchNominatimEffect(query)) {
  const name = request.name.trim(), address = request.address.trim()
  if (isGarbageVenueName(name) || isPlaceholderVenue(name) || isPlaceholderVenue(address)) {
    return { outcome: 'rejected', reasons: ['Name or address is a placeholder, not a physical venue'] } satisfies VenueOutcome
  }
  const key = addressKey(address)
  if (!key) return { outcome: 'rejected', reasons: ['Address needs a street and number'] } satisfies VenueOutcome
  // Strict reads: a database outage must fail here rather than look like "no match" and create a duplicate.
  const number = key.match(/\d+/g)!.at(-1)!
  const sameAddress = ((yield* dbEffect('intake.venue-address', () => client.from('venues')
    .select('id,name,address,neighborhood').ilike('address', `%${number}%`).limit(200))) as VenueRow[])
    .filter(venue => addressKey(venue.address) === key)
  // Not the importers' matchVenueEffect: it reads any RPC error as "no match" and misses names shared by several rows.
  const similar = (yield* dbEffect('intake.venue-similar', () => client.rpc('intake_similar_venues', {
    p_name: name, p_threshold: REVIEW_QUEUE_THRESHOLD }))) as Array<VenueRow & { similarity: number }>
  const compatible = similar.filter(venue => venue.similarity >= AUTO_USE_THRESHOLD && (!addressKey(venue.address) || addressKey(venue.address) === key))
  const named = compatible.find(venue => addressKey(venue.address) === key) ?? compatible[0]
  if (named) {
    const found = { outcome: 'existing', venue: pick(named), match: named.similarity === 1 ? 'same name' : `similar name (${named.similarity.toFixed(2)})` } as const
    if (named.address && named.neighborhood) return found satisfies VenueOutcome
    // An incomplete catalog venue gets its empty fields filled, never overwritten, after the same city and barrio checks.
    const located = yield* locateEffect(geocode, address, request.neighborhood ?? null)
    if ('reasons' in located) return { outcome: 'rejected', reasons: located.reasons } satisfies VenueOutcome
    const fill = { ...(named.address ? {} : { address }), ...(named.neighborhood ? {} : { neighborhood: located.neighborhood }) }
    let update = client.from('venues').update(fill).eq('id', named.id)
    for (const field of Object.keys(fill)) update = update.is(field, null)
    const rows = (yield* dbEffect('intake.venue-complete', () => update.select('id,name,address,neighborhood'))) as VenueRow[]
    if (rows.length) yield* recordEvidenceEffect(client, rows[0], request, `completed ${Object.keys(fill).join(', ')}`, located)
    // No row means another writer filled it first; report what is there now.
    const current = rows[0] ?? ((yield* dbEffect('intake.venue-read', () => client.from('venues').select('id,name,address,neighborhood').eq('id', named.id).single())) as VenueRow)
    return { ...found, venue: pick(current), completed: rows.length ? Object.keys(fill) : [], warnings: located.warnings } satisfies VenueOutcome
  }
  const candidates = new Map<string, VenueRow & { why: string }>()
  for (const venue of similar) candidates.set(venue.id, { ...pick(venue), why: venue.similarity >= AUTO_USE_THRESHOLD
    ? 'same name at a different address' : `similar name (${venue.similarity.toFixed(2)})` })
  for (const venue of sameAddress) if (!candidates.has(venue.id)) candidates.set(venue.id, { ...pick(venue), why: 'same address, different name' })
  if (candidates.size) return { outcome: 'ambiguous', candidates: [...candidates.values()] } satisfies VenueOutcome

  const located = yield* locateEffect(geocode, address, request.neighborhood ?? null)
  if ('reasons' in located) return { outcome: 'rejected', reasons: located.reasons } satisfies VenueOutcome
  const parsed = createVenueSchema.safeParse({ name, address, neighborhood: located.neighborhood,
    website: request.website ?? '', instagram_handle: request.instagram_handle ?? '' })
  if (!parsed.success) return { outcome: 'rejected', reasons: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`) } satisfies VenueOutcome
  const venue = yield* importTry('intake.venue-create', () => createVenue(parsed.data, client))
  yield* recordEvidenceEffect(client, venue, request, 'created', located)
  return { outcome: 'created', venue: pick(venue), warnings: located.warnings } satisfies VenueOutcome
})

/** The venue's evidence lives in the existing review log as an approved row tied to the venue. A rerun of `venue` repeats it. */
const recordEvidenceEffect = (client: SupabaseClient, venue: VenueRow, request: VenueRequest, action: string,
  located: { method: string; warnings: string[] }) => dbEffect('intake.venue-evidence', () => client.from('venue_review_queue').insert({
  source: INTAKE_VENUE_SOURCE, source_venue_name: request.name.trim(), source_address: request.address.trim(), status: 'approved',
  final_venue_id: venue.id, best_match_venue_id: null, match_confidence: null, reviewed_at: new Date().toISOString(),
  notes: JSON.stringify({ action, evidence: request.evidence, neighborhood_method: located.method, warnings: located.warnings }),
}).select('id').single()).pipe(Effect.mapError(error => failure(
  `Venue ${venue.id} was ${action} but its evidence was not recorded (${error.message}); record it before using the venue`)))

const pick = (venue: VenueRow): VenueRow => ({ id: venue.id, name: venue.name, address: venue.address, neighborhood: venue.neighborhood })

/** The operator's barrio, from an authoritative source, wins; the geocoder rejects places outside the city and fills a missing barrio. */
type Located = { neighborhood: Neighborhood; method: 'stated' | 'geocoded'; warnings: string[] } | { reasons: string[] }
const locateEffect = Effect.fn('intake.venue-locate')(function*(geocode: Geocode, address: string, given: string | null) {
  // Exact barrio names only: the importer's partial matching would turn "Villa" into Villa Crespo.
  const stated = given ? NEIGHBORHOODS.find(item => fold(item) === fold(given.trim())) ?? null : null
  if (given && !stated) return { reasons: [`"${given}" is not a Buenos Aires city neighborhood`] } as Located
  const found = yield* geocode(address).pipe(Effect.map(result => ({ result, error: false })),
    Effect.catchCause(() => Effect.succeed({ result: null, error: true })))
  const warnings: string[] = []
  if (found.result) {
    const { state, country_code } = found.result.address
    if (country_code !== 'ar' || !state || fold(state) !== CITY_STATE) {
      return { reasons: [`The address geocodes outside the city of Buenos Aires (${[state, country_code].filter(Boolean).join(', ')})`] } as Located
    }
  }
  const derived = found.result ? mapNominatimNeighborhood(found.result.address.neighbourhood, found.result.address.suburb) : null
  if (!found.result) warnings.push(found.error ? 'Geocoder unavailable; city not confirmed' : 'Geocoder did not find the address; city not confirmed')
  if (stated) {
    if (derived && derived !== stated) warnings.push(`Geocoder places the address in ${derived}; kept the stated ${stated}`)
    return { neighborhood: stated, method: 'stated', warnings } as Located
  }
  return (derived ? { neighborhood: derived, method: 'geocoded', warnings }
    : { reasons: ['Neighborhood not found; supply it from an authoritative source'] }) as Located
})

// ---------------------------------------------------------------------------
// Held backlog

type CandidateRow = { id: string; revision: number; payload: Omit<Candidate, 'expected_revision'>; updated_at: string }
type PlanRow = { candidate_id: string; revision: number; action: string; reasons: string[]; receipt: unknown; created_at: string }
export type HeldGroup = {
  venue_name: string | null; venue_id: string | null; venue_only: number
  candidates: Array<{ id: string; revision: number; name: string; date: string; time: string | null; reasons: string[]; venue_only: boolean }>
}
const VENUE_REASON = /venue|lugar|sede|location|ubicaci/i
// Venue reasons a new venue cannot fix. The runbook asks operators to start such issues with "Outside the city".
const UNFIXABLE = /outside (the city|supported caba|caba)|fuera de (caba|la ciudad)|multi-venue|several venues|no location|missing evidence/i

/**
 * Future candidates never published, grouped by the physical venue they name, so one venue is resolved once.
 * Reasons come from the newest plan for the current revision plus the operator's own issues; `venue_only`
 * marks candidates whose every reason is about the venue.
 */
export function groupHeldByVenue(candidates: CandidateRow[], plans: PlanRow[], today: string): HeldGroup[] {
  const published = new Set(plans.filter(plan => plan.receipt).map(plan => plan.candidate_id))
  const groups = new Map<string, HeldGroup>()
  for (const row of candidates) {
    const candidate = row.payload
    if (candidate.date < today || published.has(row.id)) continue
    const latest = plans.filter(plan => plan.candidate_id === row.id && plan.revision === row.revision)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
    if (latest && latest.action !== 'held') continue // previewed as publishable, awaiting commit
    const reasons = [...new Set([...(latest?.reasons ?? []), ...candidate.issues, ...(latest ? [] : ['Not previewed for this revision'])])]
    const venueOnly = !candidate.venue_id && reasons.every(reason => reason === 'Not previewed for this revision' || VENUE_REASON.test(reason) && !UNFIXABLE.test(reason))
    const key = candidate.venue_id ?? (candidate.venue_name ? normalizeTitle(candidate.venue_name) : '')
    const group = groups.get(key) ?? { venue_name: candidate.venue_name, venue_id: candidate.venue_id, venue_only: 0, candidates: [] }
    group.candidates.push({ id: row.id, revision: row.revision, name: candidate.name, date: candidate.date, time: candidate.time, reasons, venue_only: venueOnly })
    if (venueOnly) group.venue_only++
    groups.set(key, group)
  }
  for (const group of groups.values()) group.candidates.sort((a, b) => a.date.localeCompare(b.date))
  return [...groups.values()].sort((a, b) => b.venue_only - a.venue_only || b.candidates.length - a.candidates.length)
}

/** Reads only future candidates and their own plans, so the listing stays bounded as history grows. */
export const heldBacklogEffect = Effect.fn('intake.held')(function*(client: SupabaseClient, now = new Date()) {
  const today = baDate(now.toISOString())
  const candidates = (yield* allRowsEffect(client, 'intake_candidates', 'id,revision,payload,updated_at',
    query => query.gte('payload->>date', today).order('id'))) as unknown as CandidateRow[]
  const plans: PlanRow[] = []
  for (let index = 0; index < candidates.length; index += 100) {
    const ids = candidates.slice(index, index + 100).map(row => row.id)
    plans.push(...(yield* allRowsEffect(client, 'intake_plans', 'candidate_id,revision,action,reasons,receipt,created_at',
      query => query.in('candidate_id', ids).order('created_at'))) as unknown as PlanRow[])
  }
  const groups = groupHeldByVenue(candidates, plans, today)
  return { today, held: groups.reduce((sum, group) => sum + group.candidates.length, 0),
    venue_only: groups.reduce((sum, group) => sum + group.venue_only, 0), groups }
})
