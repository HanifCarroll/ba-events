import { Schema, SchemaIssue } from 'effect'
import { CATEGORIES } from '#shared/lib/types.ts'

const text = (max: number) => Schema.String.pipe(Schema.check(Schema.isMaxLength(max)))
const nonempty = (max: number) => text(max).pipe(Schema.check(Schema.isMinLength(1)))
const uuid = Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)))
const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const fields = Schema.Array(Schema.Literals(['name', 'date', 'time', 'venue', 'price', 'status', 'description', 'ticket'])).pipe(Schema.check(Schema.isMinLength(1)))
/** A caption excerpt (`media_id` null) or a retained image of an Instagram observation. */
const PostEvidenceSchema = Schema.Struct({
  observation_id: uuid,
  fields,
  excerpt: nonempty(4000),
  media_id: Schema.NullOr(uuid),
})
/** An excerpt of the venue's, organizer's or ticket seller's own web page; preview and commit fetch it to verify. */
const OfficialPageEvidenceSchema = Schema.Struct({
  kind: Schema.Literal('official_page'),
  url: nonempty(2048),
  fields,
  excerpt: nonempty(1000),
})
export const EvidenceSchema = Schema.Union([PostEvidenceSchema, OfficialPageEvidenceSchema])
export type Evidence = typeof EvidenceSchema.Type
export type OfficialPageEvidence = typeof OfficialPageEvidenceSchema.Type
export const isOfficialPage = (evidence: Evidence): evidence is OfficialPageEvidence => 'kind' in evidence

/** Operator contract, shared by CLI and future background extraction. */
export const CandidateSchema = Schema.Struct({
  id: uuid,
  expected_revision: count,
  intent: Schema.Literals(['create', 'update', 'link']),
  target_event_id: Schema.NullOr(uuid),
  name: nonempty(255),
  date: Schema.String.pipe(Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))),
  time: Schema.NullOr(Schema.String.pipe(Schema.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/)))),
  venue_name: Schema.NullOr(nonempty(200)),
  venue_id: Schema.NullOr(uuid),
  description_es: Schema.NullOr(text(12000)),
  description_en: Schema.NullOr(text(12000)),
  categories: Schema.Array(Schema.Literals(CATEGORIES)).pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(6))),
  status: Schema.Literals(['scheduled', 'canceled', 'postponed']),
  price_kind: Schema.Literals(['unknown', 'free', 'fixed', 'conditional']),
  price_ars: Schema.NullOr(count),
  price_note: Schema.NullOr(text(1000)),
  ticket_url: Schema.NullOr(text(2048)),
  artwork_media_id: Schema.NullOr(uuid),
  artwork_note: Schema.optional(text(300)),
  evidence: Schema.Array(EvidenceSchema).pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(50))),
  issues: Schema.Array(nonempty(1000)).pipe(Schema.check(Schema.isMaxLength(30))),
  notes: text(4000),
  distinct_occurrence: Schema.optional(Schema.Boolean),
})
export type Candidate = typeof CandidateSchema.Type

export const SourceSchema = Schema.Struct({
  username: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z0-9_.]{1,30}$/))),
  authority: Schema.Literals(['organizer', 'venue', 'curator']),
  enabled: Schema.Boolean,
  qualification: nonempty(2000),
})
export type Source = typeof SourceSchema.Type

export function decodeCandidate(input: unknown): Candidate {
  return Schema.decodeUnknownSync(CandidateSchema, { onExcessProperty: 'error' })(input)
}

const candidateIssues = SchemaIssue.makeFormatterStandardSchemaV1()
export function candidateError(error: unknown, input: unknown): string {
  if (!Schema.isSchemaError(error)) return 'Invalid candidate; see the candidate schema'
  const issues = candidateIssues(error.issue).issues.flatMap(({ path = [], message }) => {
    const keys = path.map(segment => typeof segment === 'object' ? segment.key : segment)
    const at = (parts: readonly PropertyKey[]) => parts.reduce<unknown>((value, key) => value && typeof value === 'object' && Object.hasOwn(value, key)
      ? (value as Record<PropertyKey, unknown>)[key] : undefined, input)
    // For official pages, `kind` is valid even when the post branch of the evidence union rejects it.
    if (keys[0] === 'evidence' && keys[2] === 'kind' && message === 'Expected no excess property' && at(keys) === 'official_page') return []
    const field = keys.map((key, index) => typeof key === 'number' ? `[${key}]` : `${index ? '.' : ''}${String(key)}`).join('')
    const options = /^Expected ((?:"[^"\n]+" \| )*"[^"\n]+")$/.exec(message)?.[1]
    const actual = options ? at(keys) : undefined
    const detail = options ? `expected one of ${options.replaceAll('"', '').replaceAll(' | ', ', ')}${
      typeof actual === 'string' ? `; got ${JSON.stringify(actual.slice(0, 80))}` : ''}` : message
    return [field ? `${field}: ${detail}` : detail]
  })
  return `Invalid candidate: ${issues.join('; ')}`
}

export function validPublicUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      !url.hash && url.hostname.includes('.') && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(url.hostname)
  } catch { return false }
}
