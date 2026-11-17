/**
 * The intake API on `baeventos-jobs`: `/intake/*`, the operator CLI's backend once the intake runs on D1. Every request
 * needs `Authorization: Bearer <INTAKE_API_TOKEN>`. It exists only where the env binds `DB`, so production answers 404 to
 * every path, as before, until the cutover (delivery PR 08). Every body is decoded strictly: this is a trust boundary.
 *
 * Operations are `POST /intake/<operation>` with a JSON body, answered with the CLI's JSON output. Two carry bytes:
 * `PUT /intake/collection/media` stores an evidence image (the server checks its type and hash), and
 * `GET /intake/media/<sha256>.<ext>` reads one back for `export`. Errors are `{ "error": message }`: 400 invalid
 * input, 401 auth, 404 unknown path, 409 an operation that failed with a message the operator acts on (a stale plan, a
 * revision conflict, disabled publishing, a database error), 500 anything unexpected.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import type { D1Database, R2Bucket, Vectorize } from '@cloudflare/workers-types'
import { Effect, Schema } from 'effect'
import { boundD1Database } from '#shared/lib/db/d1.server.ts'
import { ImportOperationError } from '#features/import/core/effect-utils.ts'
import { describeImage } from '#features/import/intake/collection.ts'
import { decodeId, decodeReview, decodeSource, lookupEffect, pendingEffect, preflightEffect, publicReceipt } from '#features/import/intake/operations.ts'
import { commitPlanEffect, previewCandidateEffect, submitCandidateEffect } from '#features/import/intake/service.ts'
import { d1Intake, importSourcesEffect } from '#features/import/intake/store-d1.ts'
import { decodeVenueRequest, heldBacklogEffect, resolveIntakeVenueEffect } from '#features/import/intake/venues.ts'
import type { IntakeStore } from '#features/import/intake/store.ts'

export interface IntakeApiEnv {
  DB?: D1Database
  VECTORIZE?: Vectorize
  INTAKE_EVIDENCE?: R2Bucket
  INTAKE_ARTWORK?: R2Bucket
  INTAKE_API_TOKEN?: string
  OPENAI_API_KEY?: string
  DEEPSEEK_API_KEY?: string
}

class BadRequest extends Error {}
const MAX_JSON_BYTES = 1_048_576
const OBJECT_KEY = /^[0-9a-f]{64}\.(jpg|png|webp)$/

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const notFound = () => new Response(null, { status: 404 })

/** Constant-time: both sides are hashed first, so the comparison never depends on where they differ. */
export function bearerMatches(header: string | null, token: string | undefined): boolean {
  if (!token || token.length < 32 || !header?.startsWith('Bearer ')) return false
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(header.slice(7)), digest(token))
}

async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new BadRequest('Send a JSON body')
  const text = await request.text()
  if (text.length > MAX_JSON_BYTES) throw new BadRequest('Body too large')
  try { return JSON.parse(text) } catch { throw new BadRequest('Body is not JSON') }
}
const strict = <S extends Schema.Top>(schema: S, input: unknown): S['Type'] => {
  try { return Schema.decodeUnknownSync(schema as never, { onExcessProperty: 'error' })(input) as S['Type'] }
  catch (error) { throw new BadRequest(error instanceof Error ? error.message : 'Invalid input') }
}

const Uuid = Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)))
const Iso = Schema.String.pipe(Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/)))
const Usd = Schema.NullOr(Schema.Number.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(100))))
const Text = (max: number) => Schema.String.pipe(Schema.check(Schema.isMaxLength(max)))
// An empty Struct ignores excess keys even with onExcessProperty: 'error'; a record of Never refuses any key.
const Empty = Schema.Record(Schema.String, Schema.Never)
const ById = Schema.Struct({ id: Uuid })
const RunPatch = Schema.Struct({ id: Uuid, patch: Schema.Union([
  Schema.Struct({ state: Schema.Literal('started'), apify_run_id: Text(100), dataset_id: Text(100) }),
  Schema.Struct({ state: Schema.Literal('failed'), charged_usd: Usd }),
  Schema.Struct({ state: Schema.Literal('succeeded'), charged_usd: Usd, completed_at: Iso }),
]) })
const Observation = Schema.Struct({ run_id: Uuid, post_id: Text(100).pipe(Schema.check(Schema.isMinLength(1))),
  source_username: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z0-9_.]{1,30}$/))),
  post_url: Schema.String.pipe(Schema.check(Schema.isPattern(/^https:\/\/www\.instagram\.com\/p\/[A-Za-z0-9_-]{1,64}\/$/))),
  caption: Text(20000), published_at: Schema.NullOr(Iso), content_hash: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9a-f]{64}$/))),
  media_urls: Schema.Array(Text(4096)).pipe(Schema.check(Schema.isMaxLength(30))) })
const SourceImport = Schema.Struct({ sources: Schema.Array(Schema.Struct({
  username: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z0-9_.]{1,30}$/))),
  authority: Schema.Literals(['organizer', 'venue', 'curator']),
  qualification: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(2000))),
})).pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(1000))) })

type Handler = (store: IntakeStore, body: unknown, env: IntakeApiEnv, db: D1Database) => Effect.Effect<unknown, ImportOperationError>
/** Runs a decoder; a BadRequest it throws becomes an `intake.input` failure (a 400). */
const fromBadRequest = <A>(run: () => A) => Effect.try({ try: run, catch: error => new ImportOperationError({ operation: 'intake.input',
  message: error instanceof Error ? error.message : 'Invalid input' }) })

/** Every JSON operation, by path below `/intake/`. */
const OPERATIONS: Record<string, Handler> = {
  preflight: (store, body, env) => fromBadRequest(() => strict(Empty, body)).pipe(Effect.andThen(() =>
    preflightEffect(store, { embedding: !!env.OPENAI_API_KEY, presentation: !!env.DEEPSEEK_API_KEY }))),
  'sources/list': (store, body) => fromBadRequest(() => strict(Empty, body)).pipe(Effect.andThen(() => store.sources())),
  source: (store, body) => decodeSource(body).pipe(Effect.flatMap(source => store.upsertSource(source))),
  // Hermes' bulk import (replaces import_sources.py): new usernames inserted disabled, existing ones untouched.
  sources: (_store, body, _env, db) => fromBadRequest(() => {
    const { sources } = strict(SourceImport, body)
    const usernames = sources.map(source => source.username)
    if (new Set(usernames).size !== usernames.length) throw new BadRequest('Duplicate usernames')
    return sources.map(source => ({ ...source, qualification: source.qualification.trim() }))
  }).pipe(Effect.flatMap(sources => sources.some(source => !source.qualification)
    ? Effect.fail(new ImportOperationError({ operation: 'intake.input', message: 'Every qualification needs text' }))
    : importSourcesEffect(db, sources))),
  pending: (store, body) => fromBadRequest(() => strict(Empty, body)).pipe(Effect.andThen(() => pendingEffect(store))),
  candidates: (store, body) => fromBadRequest(() => strict(Empty, body)).pipe(Effect.andThen(() => store.candidates())),
  held: (store, body) => fromBadRequest(() => strict(Empty, body)).pipe(Effect.andThen(() => heldBacklogEffect(store))),
  lookup: (store, body) => fromBadRequest(() => strict(Schema.Struct({ name: Schema.String }), body))
    .pipe(Effect.flatMap(({ name }) => lookupEffect(store, name))),
  venue: (store, body) => fromBadRequest(() => {
    try { return decodeVenueRequest(body) } catch (error) {
      throw new BadRequest(`Invalid venue request: ${error instanceof Error ? error.message : 'see docs/instagram-intake.md'}`)
    }
  }).pipe(Effect.flatMap(request => resolveIntakeVenueEffect(store, request))),
  submit: (store, body) => submitCandidateEffect(store, body),
  preview: (store, body) => fromBadRequest(() => strict(ById, body)).pipe(Effect.flatMap(({ id }) => previewCandidateEffect(store, id))),
  commit: (store, body) => fromBadRequest(() => strict(ById, body)).pipe(Effect.flatMap(({ id }) => commitPlanEffect(store, id)), Effect.map(publicReceipt)),
  review: (store, body) => decodeReview(body).pipe(Effect.flatMap(review => store.reviewObservation(review.observation_id, review.note))),

  // `collect` runs Apify and downloads images on the operator's Mac; these are the store calls it makes.
  'collection/policy': (store, body) => fromBadRequest(() => strict(Empty, body)).pipe(Effect.andThen(() => store.policy())),
  'collection/reserve': (store, body) => fromBadRequest(() => strict(Empty, body)).pipe(Effect.andThen(() => store.reserveCollection())),
  'collection/run': (store, body) => fromBadRequest(() => strict(RunPatch, body)).pipe(Effect.flatMap(({ id, patch }) => store.updateRun(id, patch)), Effect.as({ ok: true })),
  'collection/latest': (store, body) => fromBadRequest(() => strict(Schema.Struct({ post_id: Text(100) }), body))
    .pipe(Effect.flatMap(({ post_id }) => store.latestObservation(post_id))),
  'collection/seen': (store, body) => fromBadRequest(() => strict(ById, body)).pipe(Effect.flatMap(({ id }) => store.touchObservation(id)), Effect.as({ ok: true })),
  'collection/observe': (store, body) => fromBadRequest(() => strict(Observation, body)).pipe(Effect.flatMap(row => store.upsertObservation({ ...row, media_urls: [...row.media_urls] }))),
  'collection/positions': (store, body) => fromBadRequest(() => strict(ById, body)).pipe(Effect.flatMap(({ id }) => store.mediaPositions(id))),
}

async function run(effect: Effect.Effect<unknown, ImportOperationError>): Promise<Response> {
  const result = await Effect.runPromise(Effect.result(effect))
  if (result._tag === 'Failure') {
    const error = result.failure
    return json({ error: error.message }, error.operation === 'intake.input' ? 400 : 409)
  }
  return json(result.success ?? null)
}

/** `/intake/*` on the jobs Worker; any other path, or any env without D1, is a 404 as before. */
export async function handleIntakeRequest(request: Request, env: IntakeApiEnv): Promise<Response> {
  const url = new URL(request.url)
  const db = boundD1Database(env)
  if (!db || !url.pathname.startsWith('/intake/')) return notFound()
  if (!bearerMatches(request.headers.get('authorization'), env.INTAKE_API_TOKEN)) return json({ error: 'Unauthorized' }, 401)
  if (!env.VECTORIZE || !env.INTAKE_EVIDENCE || !env.INTAKE_ARTWORK) return json({ error: 'Intake API is not configured' }, 500)
  const store = d1Intake({ db, vectors: env.VECTORIZE, evidence: env.INTAKE_EVIDENCE, artwork: env.INTAKE_ARTWORK })
  const path = url.pathname.slice('/intake/'.length)
  try {
    if (path === 'collection/media' && request.method === 'PUT') {
      const observationId = strict(Uuid, url.searchParams.get('observation_id'))
      const position = Number(url.searchParams.get('position'))
      if (!Number.isInteger(position) || position < 0 || position >= 30) throw new BadRequest('Invalid position')
      const declared = Number(request.headers.get('content-length'))
      if (declared > 10_485_760) throw new BadRequest('Image exceeds limit')
      const bytes = new Uint8Array(await request.arrayBuffer())
      const image = await describeImage(bytes).catch((error: Error) => { throw new BadRequest(error.message) })
      return run(store.retainImage(observationId, position, image).pipe(Effect.as({ object_key: image.object_key })))
    }
    const key = path.match(/^media\/(.+)$/)?.[1]
    if (key !== undefined && request.method === 'GET') {
      if (!OBJECT_KEY.test(key)) throw new BadRequest('Invalid retained media key')
      const object = await env.INTAKE_EVIDENCE.get(key)
      if (!object) return json({ error: 'Evidence image not found' }, 404)
      return new Response(object.body as unknown as ReadableStream, { headers: { 'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream' } })
    }
    const operation = OPERATIONS[path]
    if (!operation || request.method !== 'POST') return json({ error: 'Unknown intake operation' }, 404)
    const body = await readJson(request)
    return await run(operation(store, body, env, db))
  } catch (error) {
    if (error instanceof BadRequest) return json({ error: error.message }, 400)
    console.error('intake api', path, error instanceof Error ? error.message : error)
    return json({ error: 'Intake API failed' }, 500)
  }
}
