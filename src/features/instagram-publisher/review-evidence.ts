import { z } from 'zod'
import { downloadArtwork, loadSharp, rasterJpeg } from './artwork.ts'
import type { SourceEvidence } from './review.ts'

/** Prefer the latest direct source over a curator, and select a cited image before a generic first slide. */
export function reviewEvidenceSql(ids: string[]) {
  if (!ids.length || ids.some(id => !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id))) {
    throw new Error('Review evidence requires UUID event ids.')
  }
  return `WITH ranked AS (
  SELECT x.event_id AS id, o.id AS observation_id, o.caption, o.post_url, o.published_at, o.media_urls, r.payload,
    ROW_NUMBER() OVER (PARTITION BY x.event_id ORDER BY (s.authority IN ('venue', 'organizer')) DESC,
      COALESCE(o.published_at, o.observed_at) DESC, o.observed_at DESC, x.revision DESC, o.id, x.candidate_id) AS rank
  FROM event_source_evidence x JOIN intake_observations o ON o.id = x.observation_id
    LEFT JOIN instagram_sources s ON s.username = o.source_username
    LEFT JOIN intake_candidate_revisions r ON r.candidate_id = x.candidate_id AND r.revision = x.revision
  WHERE x.event_id IN (${ids.map(id => `'${id}'`).join(', ')})
), picked AS (SELECT * FROM ranked WHERE rank = 1), images AS (
  SELECT p.id, m.object_key, m.position, ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY
    EXISTS (SELECT 1 FROM json_each(p.payload, '$.evidence') e WHERE json_extract(e.value, '$.media_id') = m.id) DESC,
    COALESCE(m.id = json_extract(p.payload, '$.artwork_media_id'), 0) DESC, m.position) AS rank
  FROM picked p JOIN intake_media m ON m.observation_id = p.observation_id
)
SELECT p.id, p.caption, p.post_url, p.published_at, m.object_key,
  json_extract(p.media_urls, '$[' || COALESCE(m.position, 0) || ']') AS media_url,
  (SELECT json_group_array(json(e.value)) FROM json_each(p.payload, '$.evidence') e
    WHERE json_extract(e.value, '$.kind') = 'official_page') AS official_excerpts
FROM picked p LEFT JOIN images m ON m.id = p.id AND m.rank = 1`
}

const rows = z.array(z.object({ id: z.string(), caption: z.string(), post_url: z.string(), published_at: z.string().nullable(),
  object_key: z.string().regex(/^[0-9a-f]{64}\.(jpg|png|webp)$/).nullable(), media_url: z.string().nullable(), official_excerpts: z.string().nullable() }))

export async function loadReviewSources(ids: string[], read: (sql: string) => Promise<unknown>, retained: (key: string) => Promise<Buffer | null>,
  fetchImpl: typeof fetch = fetch): Promise<Map<string, SourceEvidence>> {
  const result = rows.safeParse(await read(reviewEvidenceSql(ids)))
  if (!result.success) throw new Error('D1 read did not return valid review evidence.')
  const sharp = await loadSharp()
  const sources = new Map<string, SourceEvidence>()
  for (const row of result.data) {
    const saved = row.object_key ? await retained(row.object_key) : null
    // Original CDN URLs may have expired. The approved artwork downloader bounds and checks every request.
    const bytes = saved ?? (row.media_url ? await downloadArtwork(row.media_url, fetchImpl).catch(() => null) : null)
    const raster = bytes ? await rasterJpeg(sharp, bytes).catch(() => null) : null
    sources.set(row.id, { caption: row.caption, postUrl: row.post_url, publishedAt: row.published_at, officialExcerpts: row.official_excerpts,
      flyer: raster ? `data:image/jpeg;base64,${raster.data.toString('base64')}` : undefined })
  }
  return sources
}
