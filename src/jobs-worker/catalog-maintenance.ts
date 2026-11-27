import type { D1Database, Vectorize } from '@cloudflare/workers-types'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { judgeScheduledScope } from '#features/events/scope/catalog.ts'
import { BA_TIMEZONE } from '#shared/lib/constants.ts'
import { boundD1Database } from '#shared/lib/db/d1.server.ts'
import { boundVectorize, reconcileCatalog, settlePastVectors } from '#shared/lib/db/vector-sync.ts'
import type { CRON_TASKS } from './schedule.ts'

const HOUR = 3_600_000
const DATE_ONLY = '(time_tba = 1 OR coalesce(is_all_day, 0) = 1)'

/** Hourly expiration: date-only events stay through their Buenos Aires start day. */
export async function markPastEvents(db: D1Database, vectors: Vectorize, now = new Date()): Promise<{ marked: number; vectorsUpdated: number }> {
  const iso = (ms: number) => new Date(ms).toISOString()
  const today = formatInTimeZone(now, BA_TIMEZONE, 'yyyy-MM-dd')
  const midnight = fromZonedTime(`${today}T00:00:00`, BA_TIMEZONE).toISOString()
  const { results } = await db.prepare(`UPDATE events SET status = 'past'
    WHERE status IN ('scheduled', 'pending_review') AND (
      (ends_at < ?1 AND (NOT ${DATE_ONLY} OR starts_at < ?4))
      OR (ends_at IS NULL AND NOT ${DATE_ONLY} AND starts_at < ?2)
      OR (ends_at IS NULL AND ${DATE_ONLY} AND starts_at < ?3))
    RETURNING id`).bind(now.toISOString(), iso(now.getTime() - 4 * HOUR), iso(now.getTime() - 28 * HOUR), midnight).all<{ id: string }>()
  // RETURNING shows the row before the intake-protection trigger; settle reads the final status.
  return settlePastVectors(db, vectors, results.map(row => row.id))
}

/** Run the hourly expiration or nightly Vectorize reconcile only where D1 is bound. */
export async function runCatalogTask(task: (typeof CRON_TASKS)[keyof typeof CRON_TASKS], env: { DB?: unknown; VECTORIZE?: unknown }): Promise<unknown> {
  const db = boundD1Database(env)
  if (!db) return { skipped: 'no D1 binding' }
  const vectors = boundVectorize(env)
  if (!vectors) throw new Error('The DB binding needs a VECTORIZE binding too')
  if (task === 'mark-past-events') {
    const past = await markPastEvents(db, vectors)
    console.log('[mark-past-events]', past)
    const scope = await judgeScheduledScope(db)
    console.log('[event-scope]', scope)
    return { ...past, scope }
  }
  const result = await reconcileCatalog(db, vectors)
  console.log(`[${task}]`, result)
  return result
}
