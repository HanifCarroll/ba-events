/** Operator venue resolution for the Instagram intake: dedupe, check the city and neighborhood, create, keep evidence. */
import { Effect, Schema } from 'effect'
import { createVenueSchema } from '#shared/lib/schemas.ts'
import type { Neighborhood } from '#shared/lib/types.ts'
import { ImportOperationError } from '../core/effect-utils.ts'
import { mapNominatimNeighborhood, searchNominatimEffect, type NominatimResult, type NominatimSearchOptions } from '../core/nominatim.ts'
import { trimVenueName } from '../core/venue-identity.ts'
import { REVIEW_QUEUE_THRESHOLD, areaOnlyVenueName, isGarbageVenueName, isPlaceholderVenue } from '../core/venue-settlement.ts'
import { validPublicUrl } from './schema.ts'
import { baDate, normalizeTitle } from './planning.ts'
import type { CandidateRow, IntakeStore, PlanSummary, VenueRow } from './store.ts'
import { addressKey, barrio, duplicateAddressKey, fold, lookupUsig, municipalAddress } from './venue-address.ts'

const text = (min: number, max: number) => Schema.String.pipe(Schema.check(Schema.isMinLength(min), Schema.isMaxLength(max)))
export const VenueRequestSchema = Schema.Struct({
  name: text(3, 150),
  address: text(3, 300),
  neighborhood: Schema.optional(Schema.NullOr(text(3, 80))),
  website: Schema.optional(Schema.NullOr(text(1, 2048))),
  instagram_handle: Schema.optional(Schema.NullOr(Schema.String.pipe(Schema.check(Schema.isPattern(/^@?[A-Za-z0-9_.]{1,30}$/))))),
  evidence: Schema.Array(Schema.Struct({ url: text(1, 2048), confirms: text(3, 1000) }))
    .pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(20))),
  // Catalog lookalikes the operator checked and found to be other places, each with a concrete reason.
  distinct_from: Schema.optional(Schema.Array(Schema.Struct({ venue_id: text(36, 36), reason: text(10, 1000) }))
    .pipe(Schema.check(Schema.isMaxLength(20)))),
})
export type VenueRequest = typeof VenueRequestSchema.Type
export type VenueOutcome =
  | { outcome: 'existing'; venue: VenueRow; match: string; completed?: string[]; warnings?: string[]
    corrected?: { neighborhood: { from: string; to: string } } }
  | { outcome: 'created'; venue: VenueRow; warnings: string[]; distinct_from?: VenueRequest['distinct_from'] }
  | { outcome: 'ambiguous'; candidates: Array<VenueRow & { why: string }>; reasons?: string[] }
  | { outcome: 'rejected'; reasons: string[] }
export type Geocode = (query: string, options?: NominatimSearchOptions) => Effect.Effect<NominatimResult | null, unknown>
type CityLookup = (address: string, key: string, explicit: boolean) => Effect.Effect<Neighborhood | 'ambiguous' | 'provincia-namesake' | null>
// Nominatim allows one request a second; only the second, city-biased lookup of a `venue` call waits.
const nominatim: Geocode = (query, options) => options?.cityBias
  ? Effect.sleep(1000).pipe(Effect.andThen(searchNominatimEffect(query, 1, options))) : searchNominatimEffect(query)

export const INTAKE_VENUE_SOURCE = 'instagram-intake'
const CITY_STATE = 'ciudad autonoma de buenos aires'
const failure = (message: string) => new ImportOperationError({ operation: 'intake.venue', message })

/** Accents, case, spacing and punctuation removed: "BIRIBIRI  Club-Social" and "Biribiri club social" are the same name. */
export const nameKey = (name: string) => fold(name).replace(/[^\p{L}\p{N}]+/gu, '')
// Generic words around a venue's own name; dropped only to find possible aliases, never to reuse automatically.
const AFFIXES = /\b(club social|club|espacio cultural|espacio|centro cultural|cc|teatro|bar|la|el|los|las)\b/g
const aliasKey = (name: string) => nameKey(fold(name).replace(/[^\p{L}\p{N}]+/gu, ' ').replace(AFFIXES, ' '))
/** Conservative alias test: the distinctive parts of the names are equal or one contains the other. */
export function possibleAlias(a: string, b: string): boolean {
  const x = aliasKey(a), y = aliasKey(b)
  return x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x))
}

export function decodeVenueRequest(input: unknown): VenueRequest {
  const request = Schema.decodeUnknownSync(VenueRequestSchema, { onExcessProperty: 'error' })(input)
  if (request.evidence.some(item => !validPublicUrl(item.url))) throw new Error('Each evidence URL must be a public HTTPS address')
  return request
}

/**
 * Reuses a catalog venue automatically only when exactly one venue has the same normalized name, no other venue could be the
 * same place (similar name, alias, or the same address), and nothing about its location conflicts. Everything else that
 * might be a match is `ambiguous`, unless every candidate is only a similar name or alias that the operator lists in
 * `distinct_from` with a reason. A repeated request finds the venue it created (same name), so `venue` is idempotent.
 */
export const resolveIntakeVenueEffect = Effect.fn('intake.venue')(function*(store: IntakeStore, request: VenueRequest,
  { geocode, cityLookup }: { geocode: Geocode; cityLookup?: CityLookup } = { geocode: nominatim, cityLookup: lookupUsig }) {
  const name = trimVenueName(request.name), address = request.address.trim()
  // A barrio-named place passes: the address below must carry a house number. A city or postal code never does.
  if (!name || isGarbageVenueName(name) || areaOnlyVenueName(name) === 'city' || isPlaceholderVenue(name) || isPlaceholderVenue(address)) {
    return { outcome: 'rejected', reasons: ['Name or address is a placeholder, not a physical venue'] } satisfies VenueOutcome
  }
  const key = addressKey(address)
  if (!key) return { outcome: 'rejected', reasons: ['Address needs a street name followed by a house number'] } satisfies VenueOutcome
  const locate = (given: string | null) => locateEffect(geocode, cityLookup, address, key, given, request.evidence)
  // Strict reads: a database outage must fail here rather than look like "no match" and create a duplicate.
  const venues = yield* store.allVenues()
  const similar = yield* store.similarVenues(name, REVIEW_QUEUE_THRESHOLD)
  // Refuse an unusually large set of lookalikes rather than taking a partial match.
  if (similar.length >= 1000) return yield* failure('Too many similar venue names to check; use a more specific name')
  const candidates = new Map<string, VenueRow & { why: string }>()
  const blocking = new Set<string>() // same name or same address: `distinct_from` can never override these
  const flag = (venue: VenueRow, why: string, blocks = false) => {
    if (blocks) blocking.add(venue.id)
    if (!candidates.has(venue.id)) candidates.set(venue.id, { ...pick(venue), why })
  }
  const stated = request.neighborhood ? barrio(request.neighborhood) : null
  const conflict = (venue: VenueRow, neighborhood: string | null) => !!venue.address && addressKey(venue.address) !== key ||
    !!venue.neighborhood && !!neighborhood && venue.neighborhood !== neighborhood
  const same = venues.filter(venue => nameKey(venue.name) === nameKey(name))
  for (const venue of same) flag(venue, !conflict(venue, stated) ? 'same name'
    : venue.address && addressKey(venue.address) !== key ? 'same name, different address' : 'same name, different barrio', true)
  for (const venue of similar) flag(venue, `similar name (${Number(venue.similarity).toFixed(2)})`)
  for (const venue of venues) if (possibleAlias(venue.name, name)) flag(venue, 'possible alias')
  const duplicateKey = duplicateAddressKey(address, key)
  for (const venue of venues) {
    const storedKey = addressKey(venue.address)
    if (storedKey === key || duplicateKey && duplicateAddressKey(venue.address, storedKey) === duplicateKey) flag(venue, 'same address', true)
  }
  const distinct = new Map((request.distinct_from ?? []).map(item => [item.venue_id, item.reason.trim()]))
  const cleared = (id: string) => !blocking.has(id) && !!distinct.get(id)
  // Other lookalikes the operator cleared don't stop the one same-name venue from matching, which keeps a retry idempotent.
  const named = same.length === 1 && [...candidates.keys()].every(id => id === same[0].id || cleared(id)) ? same[0] : null
  // A wrong stored barrio at the same street and number: the operator's barrio replaces it only when the geocoder confirms it.
  if (named && stated && named.neighborhood && named.neighborhood !== stated && !!named.address && addressKey(named.address) === key) {
    const located = yield* locate(stated)
    if ('outcome' in located) return located satisfies VenueOutcome
    if (located.official !== stated) {
      return { outcome: 'ambiguous', candidates: [{ ...pick(named), why: located.official
        ? `same name and address, stored in ${named.neighborhood}; the geocoder places it in ${located.official}, not ${stated}`
        : `same name and address, stored in ${named.neighborhood}; the geocoder could not confirm ${stated}` }] } satisfies VenueOutcome
    }
    const from = named.neighborhood
    const rows = yield* store.correctVenueNeighborhood(named.id, from, stated)
    if (!rows.length) return yield* failure(`Venue ${named.id} changed while correcting its barrio; run venue again`)
    yield* recordEvidenceEffect(store, rows[0], request, `corrected neighborhood from ${from} to ${stated}`, located)
    return { outcome: 'existing', venue: pick(rows[0]), match: 'same name and address', corrected: { neighborhood: { from, to: stated } },
      warnings: located.warnings } satisfies VenueOutcome
  }
  if (named && !conflict(named, stated)) {
    const found = { outcome: 'existing', venue: pick(named), match: 'same name' } as const
    if (named.address && named.neighborhood) return found satisfies VenueOutcome
    // An incomplete catalog venue gets its empty fields filled, never overwritten, after the same city and barrio checks.
    const located = yield* locate(request.neighborhood ?? null)
    if ('outcome' in located) return located satisfies VenueOutcome
    if (conflict(named, located.neighborhood)) {
      return { outcome: 'ambiguous', candidates: [{ ...pick(named), why: `same name, but this address is in ${located.neighborhood}` }] } satisfies VenueOutcome
    }
    const fill = { ...(named.address ? {} : { address }), ...(named.neighborhood ? {} : { neighborhood: located.neighborhood }) }
    const rows = yield* store.completeVenue(named.id, fill)
    if (rows.length) yield* recordEvidenceEffect(store, rows[0], request, `completed ${Object.keys(fill).join(', ')}`, located)
    // No row means another writer filled it first; report what is there now.
    const current = rows[0] ?? (yield* store.venueRow(named.id))
    return { ...found, venue: pick(current), completed: rows.length ? Object.keys(fill) : [], warnings: located.warnings } satisfies VenueOutcome
  }
  if (![...candidates.keys()].every(cleared)) return { outcome: 'ambiguous', candidates: [...candidates.values()] } satisfies VenueOutcome

  const located = yield* locate(request.neighborhood ?? null)
  if ('outcome' in located) return located satisfies VenueOutcome
  const parsed = createVenueSchema.safeParse({ name, address, neighborhood: located.neighborhood,
    website: request.website ?? '', instagram_handle: request.instagram_handle ?? '' })
  if (!parsed.success) return { outcome: 'rejected', reasons: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`) } satisfies VenueOutcome
  const venue = yield* store.createVenue(parsed.data)
  yield* recordEvidenceEffect(store, venue, request, 'created', located)
  return { outcome: 'created', venue: pick(venue), warnings: located.warnings,
    ...(candidates.size ? { distinct_from: request.distinct_from } : {}) } satisfies VenueOutcome
})

/** The venue's evidence lives in the existing review log as an approved row tied to the venue. A rerun of `venue` repeats it. */
const recordEvidenceEffect = (store: IntakeStore, venue: VenueRow, request: VenueRequest, action: string,
  located: { method: string; warnings: string[] }) => store.recordVenueEvidence({
  source: INTAKE_VENUE_SOURCE, source_venue_name: request.name.trim(), source_address: request.address.trim(), status: 'approved',
  final_venue_id: venue.id, best_match_venue_id: null, match_confidence: null, reviewed_at: new Date().toISOString(),
  notes: JSON.stringify({ action, evidence: request.evidence, distinct_from: request.distinct_from ?? [],
    neighborhood_method: located.method, warnings: located.warnings }),
}).pipe(Effect.mapError(error => failure(
  `Venue ${venue.id} (${venue.name}) was ${action} but has no evidence row (${error.message}). A retry returns it as existing without adding one, so note this venue ID in the run memory and report`)))

const pick = (venue: VenueRow): VenueRow => ({ id: venue.id, name: venue.name, address: venue.address, neighborhood: venue.neighborhood })

const inCity = (result: NominatimResult) => result.address.country_code === 'ar' && !!result.address.state && fold(result.address.state) === CITY_STATE
const rejectLocation = (reason: string) => ({ outcome: 'rejected' as const, reasons: [reason] })
const holdLocation = (reason: string) => ({ outcome: 'ambiguous' as const, reasons: [reason], candidates: [] })
const locateEffect = Effect.fn('intake.venue-locate')(function*(geocode: Geocode, cityLookup: CityLookup | undefined,
  address: string, requested: string, given: string | null, evidence: VenueRequest['evidence']) {
  const height = requested.slice(requested.lastIndexOf(' ') + 1)
  const qualification = municipalAddress(address, height, evidence)
  const stated = given ? barrio(given) : qualification?.neighborhood ?? null
  if (given && !stated) return rejectLocation(`"${given}" is not a Buenos Aires city neighborhood`)
  const lookup = (options?: NominatimSearchOptions) => geocode(address, options).pipe(Effect.map(result => ({ result, error: false })),
    Effect.catchCause(() => Effect.succeed({ result: null, error: true })))
  const exact = (result: NominatimResult | null): result is NominatimResult => !!result?.address.road &&
    result.address.house_number === height && addressKey(`${result.address.road} ${height}`) === requested
  const plain = yield* lookup()
  const result = exact(plain.result) || plain.error ? plain.result : (yield* lookup({ cityBias: true })).result
  const outside = result && !inCity(result) ? result : null
  const confirmed = !outside && exact(result) ? result : null
  const place = outside?.address
  const elsewhere = place ? `The address geocodes outside the city of Buenos Aires (${[place.town ?? place.municipality ?? place.city ?? place.suburb, place.state, place.country_code].filter(Boolean).join(', ')})` : ''
  if (outside && exact(outside) && !qualification?.explicit) {
    return holdLocation(`${elsewhere}; confirm the CABA locality in the address or evidence`)
  }
  const municipal = !confirmed && cityLookup && qualification ? yield* cityLookup(qualification.query, requested, qualification.explicit) : null
  if (municipal === 'provincia-namesake') return holdLocation('USIG found the exact address in CABA and Provincia; confirm the CABA locality in the address or evidence')
  if (municipal === 'ambiguous') return holdLocation('USIG found more than one CABA street matching the address')
  if (!confirmed && !municipal) return rejectLocation(elsewhere || 'The geocoders could not confirm the exact CABA street and house number')
  // Only USIG or an exact Nominatim result's official suburb may block or correct a stated barrio.
  const official = municipal ?? (confirmed?.address.suburb ? barrio(confirmed.address.suburb) : null)
  if (official) {
    const conflict = [stated, qualification?.neighborhood].find(value => value && value !== official)
    if (conflict) return holdLocation(`${municipal ? 'USIG' : 'Nominatim'} places the address in ${official}, not the stated ${conflict}`)
  }
  const warnings: string[] = []
  const derived = municipal ?? (confirmed ? mapNominatimNeighborhood(confirmed.address.neighbourhood, confirmed.address.suburb) : null)
  if (stated) {
    if (derived && derived !== stated) warnings.push(`Geocoder places the address in ${derived}; kept the stated ${stated}`)
    return { neighborhood: stated, method: municipal ? 'usig' : 'stated', warnings, official }
  }
  return derived ? { neighborhood: derived, method: municipal ? 'usig' : 'geocoded', warnings, official }
    : rejectLocation('Neighborhood not found; supply it from an authoritative source')
})

// ---------------------------------------------------------------------------
// Held backlog

type PlanRow = PlanSummary
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
export const heldBacklogEffect = Effect.fn('intake.held')(function*(store: IntakeStore, now = new Date()) {
  const today = baDate(now.toISOString())
  const candidates = yield* store.futureCandidates(today)
  const plans: PlanRow[] = []
  for (let index = 0; index < candidates.length; index += 100) {
    plans.push(...(yield* store.plansFor(candidates.slice(index, index + 100).map(row => row.id))))
  }
  const groups = groupHeldByVenue(candidates, plans, today)
  return { today, held: groups.reduce((sum, group) => sum + group.candidates.length, 0),
    venue_only: groups.reduce((sum, group) => sum + group.venue_only, 0), groups }
})
