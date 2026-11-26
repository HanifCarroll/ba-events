/** Intake persistence via the jobs Worker; the CLI drives collection over the authenticated intake API. */
import type { Effect } from 'effect'
import type { EventInsert } from '#shared/lib/types.ts'
import type { ImportOperationError } from '../core/effect-utils.ts'
import type { Candidate, Source } from './schema.ts'
import type { Media } from './planning.ts'

type Op<A> = Effect.Effect<A, ImportOperationError>
type Row = Record<string, unknown>

export type IntakePolicy = {
  publishing_enabled: boolean; collection_enabled: boolean; max_sources: number; posts_per_source: number
  run_cap_usd: number; monthly_cap_usd: number; actor_build: string; data_detail_level: string
}
export type Reservation = Row & {
  id: string; fresh: boolean; apify_run_id: string | null; reserved_usd: number; created_at: string; actor_build?: string
  input: Row & { username: string[]; resultsLimit: number }
}
export type RunPatch =
  | { state: 'started'; apify_run_id: string; dataset_id: string }
  | { state: 'failed'; charged_usd: number | null }
  | { state: 'succeeded'; charged_usd: number | null; completed_at: string }
export type ObservationInput = {
  run_id: string; post_id: string; source_username: string; post_url: string; caption: string
  published_at: string | null; content_hash: string; media_urls: string[]
}
/** An unreviewed observation still missing some of its images: its stored URLs and the positions already saved. */
export type UnreviewedMedia = { id: string; media_urls: string[]; positions: number[] }
export type RetainedImage = { bytes: Uint8Array; content_type: string; sha256: string; object_key: string }
export type IntakePlanRow = {
  id: string; candidate_id: string; revision: number; action: 'held' | 'create' | 'update' | 'link'
  event_id: string; expected_event_updated_at: string | null; payload: EventInsert
  artwork_media_id: string | null; artwork_note?: string | null; evidence: Candidate['evidence']; reasons: string[]; receipt: Row | null
}
export type PlanInsert = Omit<IntakePlanRow, 'id' | 'receipt'>
export type VenueRow = { id: string; name: string; address: string | null; neighborhood: string | null }
export type VenueFill = { address?: string; neighborhood?: string }
export type VenueCreate = { name: string; address?: string | null; neighborhood?: string | null; website?: string | null
  instagram_handle?: string | null; parent_id?: string | null }
export type CandidateRow = { id: string; revision: number; payload: Omit<Candidate, 'expected_revision'>; updated_at: string }
export type PlanSummary = { candidate_id: string; revision: number; action: string; reasons: string[]; receipt: unknown; created_at: string }

export type MonthlyCharges = { charged_usd: number; unmeasured_runs: number }

/** What `collect` needs: the collection reservation, observations and retained evidence images. */
export interface CollectionStore {
  readonly policy: Op<IntakePolicy>
  readonly reserveCollection: Op<Reservation>
  /** Release this exact attempt only when the collector knows it sent no start request. */
  releaseCollection(id: string, reservedAt: string): Op<void>
  updateRun(id: string, patch: RunPatch): Op<MonthlyCharges | void>
  latestObservation(postId: string): Op<{ id: string; content_hash: string } | null>
  touchObservation(id: string): Op<void>
  upsertObservation(row: ObservationInput): Op<{ id: string }>
  mediaPositions(observationId: string): Op<number[]>
  /** Keeps the bytes privately and records them as the observation's image at `position`. */
  retainImage(observationId: string, position: number, image: RetainedImage): Op<void>
  /** Remote fallback: null on retention, a reason on a CDN refusal, or an operation error on an API read/write failure. */
  fetchAndRetainImage?(observationId: string, position: number): Op<string | null>
  /** Unreviewed observations with fewer saved images than URLs, oldest first. */
  readonly unreviewedMedia: Op<UnreviewedMedia[]>
}

export interface IntakeStore extends CollectionStore {
  // Operator reads
  readonly enabledSourceCount: Op<number>
  readonly storageReady: Op<boolean>
  readonly sources: Op<Row[]>
  upsertSource(source: Source): Op<Row>
  readonly unreviewedObservations: Op<Row[]>
  mediaFor(observationId: string): Op<Array<Media & Row>>
  evidenceBytes(objectKey: string): Op<Uint8Array>
  readonly candidates: Op<Row[]>
  lookupVenues(fragment: string): Op<Row[]>
  lookupEvents(fragment: string): Op<Row[]>
  reviewObservation(id: string, note: string): Op<{ id: string; reviewed_at: string }>
  // Candidates and plans
  submitCandidate(id: string, expectedRevision: number, payload: Omit<Candidate, 'expected_revision'>): Op<Row>
  candidate(id: string): Op<{ id: string; revision: number; payload: Candidate }>
  observationsByIds(ids: string[]): Op<Row[]>
  sourceAuthorities(usernames: string[]): Op<Array<{ username: string; authority: string }>>
  mediaForObservations(ids: string[]): Op<Media[]>
  venue(id: string): Op<{ id: string; name: string; neighborhood: string | null; website?: string | null } | null>
  /** The plan venue's name and barrio for the search document; fails when it doesn't exist. */
  eventVenue(id: string | null | undefined): Op<{ name: string; neighborhood: string | null }>
  /** The importers' venue match, advisory only. */
  venueHint(name: string): Op<{ id: string; name: string } | null>
  linkedEventIds(candidateId: string): Op<string[]>
  /** Every event starting in [from, to), by id. */
  eventsBetween(from: string, to: string): Op<Row[]>
  eventsByIds(ids: string[]): Op<Row[]>
  /** The public artwork URL an event gets for a retained image. */
  artworkUrl(eventId: string, media: Media): string
  insertPlan(plan: PlanInsert): Op<IntakePlanRow>
  plan(id: string): Op<IntakePlanRow>
  readonly publishingEnabled: Op<boolean>
  /** check_intake_plan: fails with the reason a plan can't be committed now. */
  checkPlan(id: string): Op<void>
  preparePlan(id: string, payload: EventInsert): Op<void>
  artworkMedia(id: string): Op<Media>
  /** Copies a retained image to the public artwork store. */
  publishArtwork(media: Media): Op<void>
  /** commit_intake_plan: one transaction; returns the receipt. */
  commitPlan(id: string): Op<Row>
  /** A retry of a committed plan: its receipt, after redoing any side effect the commit may have missed. */
  replayReceipt(plan: IntakePlanRow): Op<Row>
  // Venues
  readonly allVenues: Op<VenueRow[]>
  similarVenues(name: string, threshold: number): Op<Array<VenueRow & { similarity: number }>>
  /** Fills only the listed fields that are still empty; returns the row if it changed. */
  completeVenue(id: string, fill: VenueFill): Op<VenueRow[]>
  /** Replaces the barrio only while it is still `from`; returns the row if it changed. */
  correctVenueNeighborhood(id: string, from: string, to: string): Op<VenueRow[]>
  venueRow(id: string): Op<VenueRow>
  createVenue(venue: VenueCreate): Op<VenueRow>
  recordVenueEvidence(row: Row): Op<void>
  futureCandidates(today: string): Op<CandidateRow[]>
  /** Plans of at most 100 candidates, oldest first. */
  plansFor(candidateIds: string[]): Op<PlanSummary[]>
}
