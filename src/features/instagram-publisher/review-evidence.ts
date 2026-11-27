import { z } from 'zod'
import { downloadArtwork, loadSharp, rasterJpeg } from './artwork.ts'

const excerpt = z.object({ excerpt: z.string(), fields: z.array(z.string()) })
const officialPage = excerpt.extend({ kind: z.literal('official_page'), url: z.string() })
const sourceExcerpt = excerpt.extend({ observation_id: z.string(), media_id: z.string().nullable() })
const citations = z.array(z.union([officialPage, sourceExcerpt]))

type Excerpt = z.infer<typeof excerpt>
export interface ReviewResources {
  address: string | null
  observations: Array<{ postUrl: string; caption: string; publishedAt: string | null; excerpts: Array<Excerpt & { mediaId?: string | null }> }>
  officialPages: Array<Excerpt & { url: string }>
}
export interface SourceEvidence extends ReviewResources { flyer?: string }

/** Return all linked text. Keep the original rank-1 observation and image rules for the one flyer. */
export function reviewEvidenceSql(ids: string[]) {
  if (!ids.length || ids.some(id => !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id))) {
    throw new Error('Review evidence requires UUID event ids.')
  }
  const list = ids.map(id => `'${id}'`).join(', ')
  return `WITH ranked AS (
  SELECT x.event_id AS id, o.id AS observation_id, o.caption, o.post_url, o.published_at, o.media_urls, r.payload,
    ROW_NUMBER() OVER (PARTITION BY x.event_id ORDER BY (s.authority IN ('venue', 'organizer')) DESC,
      COALESCE(o.published_at, o.observed_at) DESC, o.observed_at DESC, x.revision DESC, o.id, x.candidate_id) AS rank
  FROM event_source_evidence x JOIN intake_observations o ON o.id = x.observation_id
    LEFT JOIN instagram_sources s ON s.username = o.source_username
    LEFT JOIN intake_candidate_revisions r ON r.candidate_id = x.candidate_id AND r.revision = x.revision
  WHERE x.event_id IN (${list})
), images AS (
  SELECT p.id, m.object_key, m.position, ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY
    EXISTS (SELECT 1 FROM json_each(p.payload, '$.evidence') e WHERE json_extract(e.value, '$.media_id') = m.id) DESC,
    COALESCE(m.id = json_extract(p.payload, '$.artwork_media_id'), 0) DESC, m.position) AS rank
  FROM ranked p JOIN intake_media m ON m.observation_id = p.observation_id WHERE p.rank = 1
)
SELECT ev.id, v.address, p.observation_id, p.caption, p.post_url, p.published_at, m.object_key,
  CASE WHEN p.rank = 1 THEN json_extract(p.media_urls, '$[' || COALESCE(m.position, 0) || ']') END AS media_url,
  json_extract(p.payload, '$.evidence') AS evidence
FROM events ev LEFT JOIN venues v ON v.id = ev.venue_id LEFT JOIN ranked p ON p.id = ev.id
  LEFT JOIN images m ON m.id = p.id AND p.rank = 1 AND m.rank = 1
WHERE ev.id IN (${list}) ORDER BY ev.id, p.rank`
}

const rows = z.array(z.object({ id: z.string(), address: z.string().nullable(), observation_id: z.string().nullable(),
  caption: z.string().nullable(), post_url: z.string().nullable(), published_at: z.string().nullable(),
  object_key: z.string().regex(/^[0-9a-f]{64}\.(jpg|png|webp)$/).nullable(), media_url: z.string().nullable(), evidence: z.string().nullable() }))

type EvidenceRow = z.infer<typeof rows>[number]
async function readEvidence(ids: string[], read: (sql: string) => Promise<unknown>) {
  const byEvent = new Map<string, EvidenceRow[]>()
  if (!ids.length) return byEvent
  const result = rows.safeParse(await read(reviewEvidenceSql(ids)))
  if (!result.success) throw new Error('D1 read did not return valid review evidence.')
  for (const row of result.data) {
    if (!byEvent.has(row.id)) byEvent.set(row.id, [])
    byEvent.get(row.id)!.push(row)
  }
  return byEvent
}

function resources(linked: EvidenceRow[]): ReviewResources {
  const observations = new Map<string, ReviewResources['observations'][number]>()
  for (const row of linked) {
    if (row.observation_id && row.post_url && !observations.has(row.observation_id)) {
      observations.set(row.observation_id, { postUrl: row.post_url, caption: row.caption ?? '', publishedAt: row.published_at, excerpts: [] })
    }
  }
  const officialPages: ReviewResources['officialPages'] = []
  const seen = new Set<string>()
  for (const row of linked) {
    if (!row.evidence) continue
    // An intake revision can cite a different observation than the row it is linked through.
    const entries: unknown = JSON.parse(row.evidence)
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      const parsed = citations.element.safeParse(entry)
      if (!parsed.success) continue
      const item = parsed.data
      const key = JSON.stringify(item)
      if (seen.has(key)) continue
      seen.add(key)
      if ('url' in item) officialPages.push({ url: item.url, excerpt: item.excerpt, fields: item.fields })
      else observations.get(item.observation_id)?.excerpts.push({ excerpt: item.excerpt, fields: item.fields, mediaId: item.media_id })
    }
  }
  return { address: linked[0]?.address ?? null, observations: [...observations.values()], officialPages }
}

/** Text-only read for Slack. No image or model calls are needed to show the evidence. */
export async function loadReviewResources(ids: string[], read: (sql: string) => Promise<unknown>): Promise<Map<string, ReviewResources>> {
  return new Map([...await readEvidence(ids, read)].map(([id, linked]) => [id, resources(linked)]))
}

export async function loadReviewSources(ids: string[], read: (sql: string) => Promise<unknown>, retained: (key: string) => Promise<Buffer | null>,
  fetchImpl: typeof fetch = fetch): Promise<Map<string, SourceEvidence>> {
  const evidence = await readEvidence(ids, read)
  const sharp = await loadSharp()
  const sources = new Map<string, SourceEvidence>()
  for (const [id, linked] of evidence) {
    const row = linked[0]!
    const saved = row.object_key ? await retained(row.object_key) : null
    // Original CDN URLs may have expired. The approved artwork downloader bounds and checks every request.
    const bytes = saved ?? (row.media_url ? await downloadArtwork(row.media_url, fetchImpl).catch(() => null) : null)
    const raster = bytes ? await rasterJpeg(sharp, bytes).catch(() => null) : null
    sources.set(id, { ...resources(linked), flyer: raster ? `data:image/jpeg;base64,${raster.data.toString('base64')}` : undefined })
  }
  return sources
}
