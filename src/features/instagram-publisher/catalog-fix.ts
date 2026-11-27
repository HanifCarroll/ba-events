import { z } from 'zod'
import type { EventColumn } from '#shared/lib/db/event-columns.ts'
import { baLocal } from './format.ts'

export const eventId = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/)
export const line = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\x00-\x1f\x7f]+$/u)
export const fixFields = ['description_display_es', 'description_display_en', 'description_summary_es', 'description_summary_en',
  'name', 'starts_at', 'price', 'is_free', 'status'] as const satisfies readonly EventColumn[]
export const fixInput = z.strictObject({ id: eventId, field: z.enum(fixFields), from: z.string().max(4000).nullable(),
  to: z.string().max(4000).nullable(), evidence: line(500), allOccurrences: z.boolean() })
export type FixInput = z.infer<typeof fixInput>
export interface FixReceipt extends FixInput { operation: string; at: string; changes: { id: string; from: string | number | null; to: string | number | null }[] }
export type CatalogQuery = (sql: string, params: string[]) => Promise<unknown[]>
export class StaleCatalogFix extends Error {}

// Keep the SQL projection order used in the investigator's JSON evidence; event-columns.test.ts checks membership.
const fields = [...fixFields, 'description_es', 'description_en', 'ends_at', 'venue_id', 'time_tba', 'is_all_day', 'categories', 'facets',
  'search_document', 'embedding_version', 'updated_at'] as const satisfies readonly EventColumn[]
const columns = fields.map(field => `e.${field}`).join(', ')
const fromEvents = 'FROM events e LEFT JOIN venues v ON v.id = e.venue_id'
const select = `SELECT e.id, ${columns}, v.name AS venue, v.neighborhood AS barrio, v.website, e.ticket_url ${fromEvents}`
const eligible = `EXISTS (SELECT 1 FROM event_source_evidence x WHERE x.event_id = e.id)`
const sameProduction = `e.venue_id = (SELECT venue_id FROM events WHERE id = ?)
  AND e.name = (SELECT name FROM events WHERE id = ?)
  AND EXISTS (SELECT 1 FROM event_source_evidence a JOIN intake_observations ao ON ao.id = a.observation_id
    JOIN intake_observations bo ON bo.post_url = ao.post_url JOIN event_source_evidence b ON b.observation_id = bo.id
    WHERE a.event_id = ? AND b.event_id = e.id AND ao.post_url <> '')`
const targets = (all: boolean) => `WHERE e.status = 'scheduled' AND ${eligible} AND ${all ? sameProduction : 'e.id = ?'}`

export const catalogRowSql = (id: string, occurrences = false) => {
  const uuid = eventId.parse(id)
  return (occurrences ? `${select} ${targets(true)} ORDER BY e.starts_at LIMIT 41` : `${select} WHERE e.id = ? AND ${eligible}`)
    .replaceAll('?', `'${uuid}'`)
}

function value(field: FixInput['field'], raw: string | null) {
  if (field === 'price') {
    if (raw === null) return null
    if (!/^\d+$/u.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error('Price must be whole nonnegative pesos or null.')
    return Number(raw)
  }
  if (field === 'is_free') {
    if (raw === '0' || raw === '1') return Number(raw)
    throw new Error('is_free must be 0 or 1.')
  }
  if (field === 'starts_at') {
    if (raw && Number.isFinite(Date.parse(raw)) && new Date(raw).toISOString() === raw) return raw
    throw new Error('Use a UTC ISO timestamp with milliseconds for starts_at.')
  }
  return raw
}

const rowSchema = z.object({ id: eventId, name: z.string(), starts_at: z.string(), ends_at: z.string().nullable(),
  price: z.number().nullable(), is_free: z.number(), status: z.string(), time_tba: z.number(), is_all_day: z.number(),
  description_es: z.string().nullable(), description_en: z.string().nullable(), description_display_es: z.string().nullable(),
  description_display_en: z.string().nullable(), description_summary_es: z.string().nullable(), description_summary_en: z.string().nullable(),
  venue_id: z.string().nullable(), venue: z.string().nullable(), barrio: z.string().nullable(), categories: z.string(), facets: z.string(),
  search_document: z.string().nullable(), embedding_version: z.number(), updated_at: z.string() })

/** Compare the full occurrence set and its search inputs inside the single statement that authorizes the fix. */
export async function applyCatalogFix(query: CatalogQuery, input: FixInput, beforeCommit: (changes: FixReceipt['changes']) => string | Promise<string>) {
  const { field, id, from, to, allOccurrences } = fixInput.parse(input)
  const old = value(field, from)
  const next = value(field, to)
  if (old === next || (field === 'name' && !line(300).safeParse(next).success) || (field === 'status' && (old !== 'scheduled' || next !== 'canceled'))) {
    throw new Error('Invalid catalog correction.')
  }
  const filter = targets(allOccurrences)
  const ids = allOccurrences ? [id, id, id] : [id]
  const rows = z.array(rowSchema).parse(await query(`${select} ${filter} ORDER BY e.id LIMIT 41`, ids))
  const anchor = rows.find(row => row.id === id)
  if (!anchor || rows.length > 40 || anchor[field] !== old) throw new Error('Catalog correction refused: stale --from or unsupported occurrence set.')
  // The investigator also imports this module for validation and reads. Load the write gateway only for a correction.
  const { writePublisherCorrection } = await import('#shared/lib/db/event-write.ts')
  const changes: FixReceipt['changes'] = []
  const updates = rows.map(row => {
    let replacement = next
    if (field === 'starts_at' && typeof old === 'string' && typeof next === 'string') {
      if (row.time_tba || row.is_all_day || row.starts_at.slice(11) !== old.slice(11) || baLocal(old).date !== baLocal(next).date) {
        throw new Error('Correct only verified start times on the original local date, with the same old clock on every occurrence.')
      }
      replacement = new Date(Date.parse(row.starts_at) + Date.parse(next) - Date.parse(old)).toISOString()
      if (baLocal(row.starts_at).date !== baLocal(replacement).date || (row.ends_at && replacement >= row.ends_at)) {
        throw new Error('The corrected start would change the event day or reach its end time.')
      }
    } else if (row[field] !== old) throw new Error('Catalog correction refused: stale --from on an occurrence.')
    const updated = rowSchema.parse({ ...row, [field]: replacement })
    if ((field === 'price' || field === 'is_free') && updated.is_free && (updated.price ?? 0) > 0) throw new Error('A free event cannot have a positive price.')
    changes.push({ id: row.id, from: row[field], to: replacement })
    return { id: row.id, to: replacement, before: row,
      after: { ...updated, venue_name: row.venue, venue_neighborhood: row.barrio } }
  })
  const { operation, applied, acknowledgement } = await writePublisherCorrection(query, { candidatesSql: `${select} ${filter}`, params: ids,
    snapshot: rows, compare: [...fields, 'venue', 'barrio'], beforeCommit: () => beforeCommit(changes), field, patch: updates })
  if (!applied.length) throw new StaleCatalogFix('Catalog correction refused: the catalog changed before the write.')
  if (z.array(z.object({ operation: eventId })).parse(acknowledgement)[0]?.operation !== operation) throw new Error('Unexpected catalog correction acknowledgement.')
  return changes
}
