/**
 * The public catalog reads on D1: the home feed, the event page, MCP `get_event`, the artwork lookup, venue details,
 * event facts, and `GET /api/events`. `client.server.ts` calls these only when the Worker binds `DB`
 * (search-bindings.server.ts), so production keeps its Supabase reads until the cutover. Rows are decoded with the
 * search reads' `toPayload`, so they have the shape Supabase's `events_with_venues` returns.
 */
import type { D1Database } from '@cloudflare/workers-types'
import type { ChatEventPayload, Venue } from '../types.ts'
import { EVENT_COLUMNS, FROM_EVENTS, toPayload } from './search-d1.server.ts'

/** Statuses the public may see, as in the Supabase reads' `.in('status', ['scheduled', 'past'])`. */
const DISPLAYABLE = `e.status IN ('scheduled', 'past')`

/** One event with its venue, or null. `displayableOnly` keeps it to scheduled and past events. */
export async function eventByIdD1(db: D1Database, id: string, displayableOnly = false): Promise<ChatEventPayload | null> {
  const row = await db.prepare(`SELECT ${EVENT_COLUMNS} FROM ${FROM_EVENTS} WHERE e.id = ?${displayableOnly ? ` AND ${DISPLAYABLE}` : ''}`)
    .bind(id).first()
  return row ? toPayload(row) : null
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

/**
 * `getHappeningSoonEvents`: scheduled events from `earliestStart` on with a photo, a location, and a description,
 * soonest first.
 */
export async function happeningSoonD1(db: D1Database, earliestStart: string, limit: number): Promise<ChatEventPayload[]> {
  const { results } = await db.prepare(`SELECT ${EVENT_COLUMNS} FROM ${FROM_EVENTS}
    WHERE e.status = 'scheduled' AND e.starts_at >= ? AND e.location_tba = 0 AND e.description_unavailable = 0
      AND e.image_url IS NOT NULL AND e.image_url != ''
      AND (v.name IS NOT NULL OR v.neighborhood IS NOT NULL OR v.address IS NOT NULL)
      AND (e.description_summary_es IS NOT NULL OR e.description_summary_en IS NOT NULL
        OR e.description_display_es IS NOT NULL OR e.description_display_en IS NOT NULL)
    ORDER BY e.starts_at, e.id LIMIT ?`).bind(new Date(earliestStart).toISOString(), limit).all()
  return results.map(toPayload)
}

/** A displayable event's `image_url`, for the artwork route; null when there is no such event. */
export async function eventArtworkD1(db: D1Database, id: string): Promise<{ image_url: string | null } | null> {
  return db.prepare(`SELECT image_url FROM events e WHERE e.id = ? AND ${DISPLAYABLE}`).bind(id).first<{ image_url: string | null }>()
}

/** One venue row, or null. Venues have only text columns, so the row needs no decoding. */
export async function venueByIdD1(db: D1Database, id: string): Promise<Venue | null> {
  return db.prepare('SELECT * FROM venues WHERE id = ?').bind(id).first<Venue>()
}
