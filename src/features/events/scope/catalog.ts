import type { D1Database } from '@cloudflare/workers-types'
import { BA_TIMEZONE } from '#shared/lib/constants.ts'
import { judgeScopeBatch, requestScopeJudgments, SCOPE_BATCH_SIZE, SCOPE_VERSION, type RequestJudgments, type ScopeDecision } from './judge.ts'

export interface ScopeRow {
  id: string
  name: string
  venue: string | null
  source: string
  starts_at: string
  scope: ScopeDecision['scope'] | null
  input: string
}

export function scopeDayStart(now: Date) {
  return `${now.toLocaleDateString('en-CA', { timeZone: BA_TIMEZONE })}T03:00:00.000Z`
}

/** Cron prioritizes recently cleared judgments, then recent imports/edits. Backfill uses a stable start/id cursor. */
export async function readScopePage(db: D1Database, from: string, limit: number, options: {
  after?: Pick<ScopeRow, 'starts_at' | 'id'>
  recentSince?: string
} = {}): Promise<ScopeRow[]> {
  const { after, recentSince } = options
  const { results } = await db.prepare(`SELECT e.id, e.name, v.name AS venue, e.source, e.starts_at, e.scope, s.input
    FROM events e LEFT JOIN venues v ON v.id = e.venue_id JOIN event_scope_inputs s ON s.id = e.id
    WHERE e.status = 'scheduled' AND e.starts_at >= ?1 AND (e.scope IS NULL OR e.scope_version IS NOT ?2)
      AND (?3 IS NULL OR (e.starts_at, e.id) > (?3, ?4))
    ORDER BY CASE WHEN e.scope_invalidated_at >= ?5 THEN e.scope_invalidated_at END DESC,
      (e.updated_at >= ?5) DESC, e.starts_at, e.id LIMIT ?6`)
    .bind(from, SCOPE_VERSION, after?.starts_at ?? null, after?.id ?? null, recentSince ?? null, limit).all<ScopeRow>()
  return results
}

export type ScopeReportRow = Pick<ScopeRow, 'id' | 'name' | 'venue' | 'source'> & { scope: ScopeDecision['scope'] | null; reason: string }

export async function processScopeBatch(db: D1Database, rows: ScopeRow[], options: {
  request: RequestJudgments
  apply: boolean
}) {
  if (options.apply && rows.some(row => row.scope !== null)) {
    // Retire decisions from an older rule even if the provider fails to replace them.
    await db.prepare(`UPDATE events SET scope = NULL, scope_reason = NULL, scope_judged_at = NULL, scope_version = NULL
      WHERE id IN (SELECT value FROM json_each(?)) AND scope IS NOT NULL AND scope_version IS NOT ?`)
      .bind(JSON.stringify(rows.filter(row => row.scope !== null).map(row => row.id)), SCOPE_VERSION).run()
  }

  let decisions: ScopeDecision[]
  try {
    decisions = await judgeScopeBatch(rows.map(row => JSON.parse(row.input)), options.request)
  } catch {
    // Don't log event text, malformed model output, or details from the provider's request.
    return { report: rows.map(({ id, name, venue, source }): ScopeReportRow => ({ id, name, venue, source,
      scope: null, reason: 'Judgment unavailable; retry this event.' })), failed: rows.length, applied: 0 }
  }

  const report = rows.map(({ id, name, venue, source }, index): ScopeReportRow => ({ id, name, venue, source, ...decisions[index]! }))
  if (!options.apply || !rows.length) return { report, failed: 0, applied: 0 }
  const judgedAt = new Date().toISOString()
  const write = db.prepare(`UPDATE events SET scope = ?, scope_reason = ?, scope_judged_at = ?, scope_version = ?, scope_invalidated_at = NULL
    WHERE id = ? AND status = 'scheduled' AND (scope IS NULL OR scope_version IS NOT ?)
      AND EXISTS (SELECT 1 FROM event_scope_inputs s WHERE s.id = events.id AND s.input = ?)`)
  const results = await db.batch(rows.map((row, index) => {
    const { scope, reason } = decisions[index]!
    return write.bind(scope, reason, judgedAt, SCOPE_VERSION, row.id, SCOPE_VERSION, row.input)
  }))
  return { report, failed: 0, applied: results.reduce((total, result) => total + result.meta.changes, 0) }
}

export async function judgeScheduledScope(db: D1Database, now = new Date(), request = requestScopeJudgments()) {
  const rows = await readScopePage(db, scopeDayStart(now), 200, { recentSince: new Date(now.getTime() - 7_200_000).toISOString() })
  const counts = { selected: rows.length, in: 0, out: 0, failed: 0, applied: 0, skipped: 0 }
  for (let i = 0; i < rows.length; i += SCOPE_BATCH_SIZE) {
    const result = await processScopeBatch(db, rows.slice(i, i + SCOPE_BATCH_SIZE), { apply: true, request })
    counts.failed += result.failed
    counts.applied += result.applied
    for (const row of result.report) if (row.scope) counts[row.scope]++
  }
  counts.skipped = counts.selected - counts.applied - counts.failed
  return counts
}
