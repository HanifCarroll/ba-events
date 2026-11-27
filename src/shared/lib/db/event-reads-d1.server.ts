/** Public catalog reads on D1: home, event, artwork, venue, event facts, and the events API. */
import type { D1Database } from '@cloudflare/workers-types'
import { catalogArtworkUrl } from '../artwork-url.ts'
import type { ChatEventPayload, EventCredit, Venue } from '../types.ts'
import { isPayWhatYouCan } from '#features/events/lib/admission.ts'
import { HOME_DOORS_ONLY_DURATION_MS, HOME_EVENT_DEFAULT_DURATION_MS, HOME_FALLBACK_LIMIT, homeWindow, occurrenceEnd, type HomeAgendaEvent, type HomeWindow } from '#features/events/lib/home-feed.ts'
import { eventColumnsWith } from './event-columns.ts'
import { EVENT_COLUMNS, FROM_EVENTS, toPayload } from './search-d1.server.ts'

const DETAIL_COLUMNS = eventColumnsWith('public', 'detail').map(column => `e.${column}`).join(', ')

/** Events visible to the public. */
const DISPLAYABLE = `e.status IN ('scheduled', 'past')`

const PRICE_NOTE = `(SELECT json_extract(r.payload, '$.price_note') FROM event_source_evidence x
  JOIN intake_candidate_revisions r ON r.candidate_id = x.candidate_id AND r.revision = x.revision
  WHERE x.event_id = e.id AND json_extract(r.payload, '$.intent') IN ('create', 'update', 'link')
    AND (json_extract(r.payload, '$.price_kind') <> 'unknown' OR json_extract(r.payload, '$.price_note') IS NOT NULL)
  ORDER BY r.created_at DESC, r.candidate_id, r.revision DESC LIMIT 1)`

/** One event with its venue, or null. `displayableOnly` keeps it to scheduled and past events. */
export async function eventByIdD1(db: D1Database, id: string, displayableOnly = false) {
  const row = await db.prepare(`SELECT ${EVENT_COLUMNS},
    ${PRICE_NOTE} AS priceNote, ${DETAIL_COLUMNS}
    FROM ${FROM_EVENTS} WHERE e.id = ?${displayableOnly ? ` AND ${DISPLAYABLE}` : ''}`)
    .bind(id).first<{ priceNote: string | null; organizer_name: string | null; organizer_url: string | null;
      performers: string | null; offers_valid_from: string | null }>()
  if (!row) return null
  const event = toPayload(row)
  const { organizer_name, organizer_url, performers, offers_valid_from } = row
  return { ...event, organizer_name, organizer_url, offers_valid_from,
    performers: performers ? JSON.parse(performers) as EventCredit[] : null,
    payWhatYouCan: isPayWhatYouCan(event.name, event.description_es, row.priceNote) }
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

// A conservative SQL prefilter for occurrences that started before the local day.
// occurrenceEnd remains the source of truth for when an occurrence stops being current.
const POSSIBLY_ONGOING = `(e.ends_at > ? OR (e.time_tba AND e.doors_at IS NOT NULL AND e.starts_at > ?)
  OR (e.ends_at IS NULL AND NOT e.is_all_day AND NOT e.time_tba AND e.starts_at > ?))`

function ongoingCandidateBounds(dayStart: string) {
  const start = Date.parse(dayStart)
  return [dayStart, new Date(start - HOME_DOORS_ONLY_DURATION_MS).toISOString(),
    new Date(start - HOME_EVENT_DEFAULT_DURATION_MS).toISOString()] as const
}

/** Current and upcoming sitemap entries, without the Agenda's artwork, week window, or grouping. */
export async function upcomingEventSitemapRowsD1(db: D1Database, asOf: Date) {
  const { start } = homeWindow(asOf)
  const { results } = await db.prepare(`
    SELECT e.id, e.updated_at, e.starts_at, e.ends_at, e.doors_at, e.time_tba, e.is_all_day FROM events e
    WHERE e.status = 'scheduled' AND e.scope = 'in' AND (e.starts_at >= ? OR ${POSSIBLY_ONGOING})
    ORDER BY e.starts_at, e.id
  `).bind(start, ...ongoingCandidateBounds(start)).all<{
    id: string; updated_at: string; starts_at: string; ends_at: string | null;
    doors_at: string | null; time_tba: number; is_all_day: number;
  }>()
  return results.filter(row => occurrenceEnd({ ...row, time_tba: row.time_tba === 1, is_all_day: row.is_all_day === 1 }) > asOf.getTime())
    .map(({ id, updated_at }) => ({ id, updated_at }))
}

const INSTAGRAM_POST = /^https:\/\/www\.instagram\.com\/(?:p|reel)\/[\w-]+\/?$/i

type AgendaRow = Omit<HomeAgendaEvent, 'is_free' | 'time_tba' | 'is_all_day' | 'location_hidden' | 'location_tba' | 'music' | 'payWhatYouCan' | 'sourceUrl'> & {
  is_free: number; time_tba: number; is_all_day: number; location_hidden: number | null; location_tba: number; music: number
  priceNote: string | null
  description_es: string | null
  sourceUrl: string | null
}

const AGENDA_ELIGIBLE = "e.scope = 'in' AND e.status = 'scheduled' AND e.image_url IS NOT NULL AND e.image_url <> ''"

export type AgendaListing = HomeAgendaEvent & {
  details: {
    updated_at: string
    source: ChatEventPayload['source']
    ticket_url: string | null
    description_es: string | null
  }
}

type DiscoveryRow = AgendaRow & Omit<AgendaListing['details'], 'description_es'>

async function selectAgendaRows<T extends AgendaRow>(db: D1Database, window: HomeWindow, discovery: boolean) {
  // Buenos Aires calendar days currently use UTC−03:00. Keep complete days so grouped slots are not cut off.
  const { results } = await db.prepare(`
    WITH tail AS (
      SELECT e.id, dense_rank() OVER (ORDER BY date(e.starts_at, '-3 hours')) AS day_rank
      FROM events e WHERE ${AGENDA_ELIGIBLE} AND e.starts_at >= ?
    ), selected AS (
      SELECT e.id FROM events e WHERE ${AGENDA_ELIGIBLE} AND e.starts_at >= ? AND e.starts_at < ?
      UNION ALL
      SELECT e.id FROM events e WHERE ${AGENDA_ELIGIBLE} AND e.starts_at < ? AND ${POSSIBLY_ONGOING}
      UNION ALL
      SELECT id FROM tail WHERE ? OR day_rank <= ?
    )
    SELECT ${discovery ? 'e.updated_at, e.source, e.ticket_url,' : ''} e.id, e.name, e.description_es, e.starts_at, e.ends_at, e.doors_at, e.time_tba, e.is_all_day, e.image_url, e.image_width, e.image_height,
      CASE WHEN coalesce(e.location_hidden, 0) = 0 AND NOT e.location_tba THEN v.id END AS venue_id,
      CASE WHEN coalesce(e.location_hidden, 0) = 0 AND NOT e.location_tba THEN v.name END AS venue_name,
      CASE WHEN coalesce(e.location_hidden, 0) = 0 AND NOT e.location_tba THEN v.neighborhood END AS venue_neighborhood,
      e.location_hidden, e.location_tba, e.price, e.is_free,
      (EXISTS (SELECT 1 FROM json_each(e.facets, '$.eventType') WHERE value = 'concert')
        OR EXISTS (SELECT 1 FROM json_each(e.facets, '$.activities') WHERE value = 'live-music')) AS music,
      (SELECT o.post_url FROM event_source_evidence x JOIN intake_observations o ON o.id = x.observation_id
        WHERE x.event_id = e.id ORDER BY o.observed_at DESC, o.id DESC LIMIT 1) AS sourceUrl,
      ${PRICE_NOTE} AS priceNote
    FROM selected JOIN events e ON e.id = selected.id LEFT JOIN venues v ON v.id = e.venue_id
    ORDER BY e.starts_at, e.id
  `).bind(window.end, window.start, window.end, window.start, ...ongoingCandidateBounds(window.start), discovery ? 1 : 0, HOME_FALLBACK_LIMIT).all<T>()
  return results
}

function toAgendaEvent({ is_free, time_tba, is_all_day, location_hidden, location_tba, music, priceNote, description_es, sourceUrl, ...card }: AgendaRow): HomeAgendaEvent {
  return {
    ...card, image_url: catalogArtworkUrl(card.id, card.image_url) ?? '',
    is_free: is_free === 1, time_tba: time_tba === 1, is_all_day: is_all_day === 1,
    location_hidden: location_hidden === 1, location_tba: location_tba === 1, music: music === 1,
    payWhatYouCan: isPayWhatYouCan(card.name, description_es, priceNote),
    sourceUrl: sourceUrl && INSTAGRAM_POST.test(sourceUrl) ? sourceUrl : null,
  }
}

/** Ongoing events and the local week, plus four later dates for the homepage fallback. */
export async function homeAgendaD1(db: D1Database, window: HomeWindow): Promise<HomeAgendaEvent[]> {
  return (await selectAgendaRows<AgendaRow>(db, window, false)).map(toAgendaEvent)
}

/** Scheduled, in-scope public cards with event images, including later dates for discovery. */
export async function discoveryAgendaD1(db: D1Database, window: HomeWindow): Promise<AgendaListing[]> {
  return (await selectAgendaRows<DiscoveryRow>(db, window, true)).map(({ updated_at, source, ticket_url, ...row }) => ({
    ...toAgendaEvent(row), details: { updated_at, source, ticket_url, description_es: row.description_es },
  }))
}

export async function enabledInstagramSourceCountD1(db: D1Database): Promise<number> {
  return await db.prepare('SELECT COUNT(*) FROM instagram_sources WHERE enabled = 1').first<number>('COUNT(*)') ?? 0
}

/** A displayable event's raw artwork reference, for the artwork route; null when no such event exists. */
export async function eventArtworkD1(db: D1Database, id: string): Promise<{ image_url: string | null } | null> {
  return db.prepare(`SELECT image_url FROM events e WHERE e.id = ? AND ${DISPLAYABLE}`).bind(id).first<{ image_url: string | null }>()
}

/** One venue row, or null. Venues have only text columns, so the row needs no decoding. */
export async function venueByIdD1(db: D1Database, id: string): Promise<Venue | null> {
  return db.prepare('SELECT * FROM venues WHERE id = ?').bind(id).first<Venue>()
}
