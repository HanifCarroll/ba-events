/** Public catalog reads on D1: home, event, artwork, venue, event facts, and the events API. */
import type { D1Database } from '@cloudflare/workers-types'
import type { ChatEventPayload, Venue } from '../types.ts'
import { normalizeText } from '../utils/normalize-text.ts'
import { HOME_EVENT_DEFAULT_DURATION_MS, HOME_FALLBACK_LIMIT, type HomeAgendaEvent, type HomeWindow } from '#features/events/lib/home-feed.ts'
import { EVENT_COLUMNS, FROM_EVENTS, toPayload } from './search-d1.server.ts'

/** Events visible to the public. */
const DISPLAYABLE = `e.status IN ('scheduled', 'past')`

/** One event with its venue, or null. `displayableOnly` keeps it to scheduled and past events. */
export async function eventByIdD1(db: D1Database, id: string, displayableOnly = false) {
  const row = await db.prepare(`SELECT ${EVENT_COLUMNS},
    CASE WHEN NOT coalesce(e.location_hidden, 0) AND NOT e.location_tba THEN v.website END AS venue_website
    FROM ${FROM_EVENTS} WHERE e.id = ?${displayableOnly ? ` AND ${DISPLAYABLE}` : ''}`)
    .bind(id).first<{ venue_website: string | null }>()
  return row ? { ...toPayload(row), venue_website: row.venue_website } : null
}

/** The events among `ids` (any status), at most 100. */
export async function eventsByIdsD1(db: D1Database, ids: readonly string[]): Promise<ChatEventPayload[]> {
  const { results } = await db.prepare(`SELECT ${EVENT_COLUMNS} FROM ${FROM_EVENTS} WHERE e.id IN (SELECT value FROM json_each(?)) LIMIT 100`)
    .bind(JSON.stringify(ids)).all()
  return results.map(toPayload)
}

/** The first `limit` events of any status by start, as `GET /api/events` lists them. */
export async function eventsByStartD1(db: D1Database, limit: number): Promise<ChatEventPayload[]> {
  const { results } = await db.prepare(`SELECT ${EVENT_COLUMNS} FROM ${FROM_EVENTS} ORDER BY e.starts_at, e.id LIMIT ?`).bind(limit).all()
  return results.map(toPayload)
}

const A_LA_GORRA = /\ba la gorra\b/
const PAY_WHAT_YOU_CAN = /\b(?:a la gorra|contribucion consciente|a voluntad|paga lo que (?:quieras|puedas))\b/
const INSTAGRAM_POST = /^https:\/\/www\.instagram\.com\/(?:p|reel)\/[\w-]+\/?$/i

type AgendaRow = Omit<HomeAgendaEvent, 'is_free' | 'time_tba' | 'is_all_day' | 'location_hidden' | 'location_tba' | 'music' | 'payWhatYouCan' | 'sourceUrl'> & {
  is_free: number; time_tba: number; is_all_day: number; location_hidden: number | null; location_tba: number; music: number
  priceNote: string | null
  description_es: string | null
  sourceUrl: string | null
}

const AGENDA_ELIGIBLE = "e.scope = 'in' AND e.status = 'scheduled' AND e.image_url IS NOT NULL AND e.image_url <> ''"

/** Ongoing occurrences and the local week, plus four later dates for date-filter fallback. */
export async function homeAgendaD1(db: D1Database, window: HomeWindow): Promise<HomeAgendaEvent[]> {
  const earliestOvernightStart = new Date(Date.parse(window.start) - HOME_EVENT_DEFAULT_DURATION_MS).toISOString()
  // Buenos Aires calendar days currently use UTC−03:00. Keep complete days so grouped slots are not cut off.
  const { results } = await db.prepare(`
    WITH tail AS (
      SELECT e.id, dense_rank() OVER (ORDER BY date(e.starts_at, '-3 hours')) AS day_rank
      FROM events e WHERE ${AGENDA_ELIGIBLE} AND e.starts_at >= ?
    ), selected AS (
      SELECT e.id FROM events e WHERE ${AGENDA_ELIGIBLE} AND e.starts_at >= ? AND e.starts_at < ?
      UNION ALL
      SELECT e.id FROM events e WHERE ${AGENDA_ELIGIBLE} AND e.starts_at < ?
        AND (e.ends_at > ? OR (e.ends_at IS NULL AND NOT e.is_all_day AND NOT e.time_tba AND e.starts_at > ?))
      UNION ALL
      SELECT id FROM tail WHERE day_rank <= ?
    )
    SELECT e.id, e.name, e.description_es, e.starts_at, e.ends_at, e.time_tba, e.is_all_day, e.image_url, e.image_width, e.image_height,
      CASE WHEN coalesce(e.location_hidden, 0) = 0 AND NOT e.location_tba THEN v.id END AS venue_id,
      CASE WHEN coalesce(e.location_hidden, 0) = 0 AND NOT e.location_tba THEN v.name END AS venue_name,
      CASE WHEN coalesce(e.location_hidden, 0) = 0 AND NOT e.location_tba THEN v.neighborhood END AS venue_neighborhood,
      e.location_hidden, e.location_tba, e.price, e.is_free,
      (EXISTS (SELECT 1 FROM json_each(e.facets, '$.eventType') WHERE value = 'concert')
        OR EXISTS (SELECT 1 FROM json_each(e.facets, '$.activities') WHERE value = 'live-music')) AS music,
      (SELECT o.post_url FROM event_source_evidence x JOIN intake_observations o ON o.id = x.observation_id
        WHERE x.event_id = e.id ORDER BY o.observed_at DESC, o.id DESC LIMIT 1) AS sourceUrl,
      (SELECT json_extract(r.payload, '$.price_note') FROM event_source_evidence x
        JOIN intake_candidate_revisions r ON r.candidate_id = x.candidate_id AND r.revision = x.revision
        WHERE x.event_id = e.id AND json_extract(r.payload, '$.intent') IN ('create', 'update', 'link')
          AND (json_extract(r.payload, '$.price_kind') <> 'unknown' OR json_extract(r.payload, '$.price_note') IS NOT NULL)
        ORDER BY r.created_at DESC, r.candidate_id, r.revision DESC LIMIT 1) AS priceNote
    FROM selected JOIN events e ON e.id = selected.id LEFT JOIN venues v ON v.id = e.venue_id
    ORDER BY e.starts_at, e.id
  `).bind(window.end, window.start, window.end, window.start, window.start, earliestOvernightStart, HOME_FALLBACK_LIMIT).all<AgendaRow>()

  return results.map(({ is_free, time_tba, is_all_day, location_hidden, location_tba, music, priceNote, description_es, sourceUrl, ...card }) => ({
    ...card, is_free: is_free === 1, time_tba: time_tba === 1, is_all_day: is_all_day === 1,
    location_hidden: location_hidden === 1, location_tba: location_tba === 1, music: music === 1,
    payWhatYouCan: A_LA_GORRA.test(normalizeText(card.name)) || A_LA_GORRA.test(normalizeText(description_es ?? '')) ||
      (typeof priceNote === 'string' && PAY_WHAT_YOU_CAN.test(normalizeText(priceNote))),
    sourceUrl: sourceUrl && INSTAGRAM_POST.test(sourceUrl) ? sourceUrl : null,
  }))
}

/** A displayable event's `image_url`, for the artwork route; null when there is no such event. */
export async function eventArtworkD1(db: D1Database, id: string): Promise<{ image_url: string | null } | null> {
  return db.prepare(`SELECT image_url FROM events e WHERE e.id = ? AND ${DISPLAYABLE}`).bind(id).first<{ image_url: string | null }>()
}

/** One venue row, or null. Venues have only text columns, so the row needs no decoding. */
export async function venueByIdD1(db: D1Database, id: string): Promise<Venue | null> {
  return db.prepare('SELECT * FROM venues WHERE id = ?').bind(id).first<Venue>()
}
