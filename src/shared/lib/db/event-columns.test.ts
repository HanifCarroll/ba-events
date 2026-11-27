import type { D1Database } from '@cloudflare/workers-types'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { INSERT_INTAKE_EVENT, UPDATE_INTAKE_EVENT } from '#features/import/intake/store-d1.ts'
import { catalogRowSql } from '#features/instagram-publisher/catalog-fix.ts'
import { buildSearchDocument, type EmbeddingEventData } from '../ai/embeddings.ts'
import { EMPTY_FACETS } from '../search-facets.ts'
import { freshD1 } from '../../../../tests/support/d1.ts'
import { EVENT_COLUMN_NAMES, eventColumnsWith } from './event-columns.ts'

let db: D1Database
let dispose: (() => Promise<void>) | undefined
let triggerSql: Map<string, string>

beforeAll(async () => {
  ({ db, dispose } = await freshD1())
  const { results } = await db.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = 'events'")
    .all<{ name: string; sql: string }>()
  triggerSql = new Map(results.map(row => [row.name, row.sql]))
}, 60_000)
afterAll(async () => { await dispose?.() })

function trigger(name: string): string {
  const sql = triggerSql.get(name)
  if (!sql) throw new Error(`Missing events trigger: ${name}`)
  return sql
}

function commaList(list: string) {
  return list.split(',').map(column => column.trim())
}

function updateOf(name: string) {
  const list = /\bAFTER\s+UPDATE\s+OF\s+([\s\S]+?)\s+ON\s+events\b/i.exec(trigger(name))?.[1]
  if (!list) throw new Error(`${name} has no UPDATE OF column list`)
  return commaList(list)
}

// Split SET at top-level commas only. Quoted text, comments, and function arguments can contain commas.
function updateColumns(sql: string, label: string) {
  const assignments = /\bUPDATE\s+events\s+SET\s+([\s\S]+)/i.exec(sql)?.[1]
  if (!assignments) throw new Error(`${label}: missing UPDATE events SET`)
  const tokens = /--[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]|\bDISTINCT\s+FROM\b|\b(?:FROM|WHERE)\b|[(),;]/gi
  const columns: string[] = []
  let depth = 0
  let start = 0
  const add = (end: number) => {
    const assignment = assignments.slice(start, end).trim()
    const name = /^([a-z_][a-z0-9_]*)\s*=\s*\S/i.exec(assignment)?.[1]
    if (!name) throw new Error(`${label}: cannot parse SET assignment: ${assignment}`)
    columns.push(name.toLowerCase())
  }
  for (const { 0: token, index } of assignments.matchAll(tokens)) {
    if (token === '(') depth++
    else if (token === ')') depth--
    else if (!depth && (token === ',' || token === ';' || /^(?:FROM|WHERE)$/i.test(token))) {
      add(index)
      if (token !== ',') return columns
      start = index + 1
    }
  }
  add(assignments.length)
  return columns
}

function expectColumns(actual: readonly string[], expected: readonly string[], label: string) {
  expect([...actual].sort(), label).toEqual([...expected].sort())
}

describe('events column policy', () => {
  it('covers exactly the migrated events table', async () => {
    const { results } = await db.prepare("PRAGMA table_info('events')").all<{ name: string }>()
    expectColumns(results.map(row => row.name), EVENT_COLUMN_NAMES, 'events schema vs column policy')
  })

  it('keeps every scope write outside the intake revision check', () => {
    const revision = updateOf('events_updated_at')
    const scopeWrites = eventColumnsWith('scope', 'judgment', 'invalidation')
    const revisionPolicy = new Set<string>(eventColumnsWith('advancesRevision', true))
    const overlap = scopeWrites.filter(column => revision.includes(column) || revisionPolicy.has(column))
    expect(overlap,
      'events_updated_at must exclude scope writes: they would break the intake revision check "Catalog changed after preview" (updated_at IS ?).',
    ).toEqual([])
  })

  it('matches the migrated revision, scope invalidation, and FTS trigger lists', () => {
    expectColumns(updateOf('events_updated_at'), eventColumnsWith('advancesRevision', true), 'events_updated_at')
    expectColumns(updateOf('events_invalidate_scope'), eventColumnsWith('scope', 'input'), 'events_invalidate_scope')
    expectColumns(updateOf('events_fts_after_update'), eventColumnsWith('fullText', true), 'events_fts_after_update')
  })

  it.each(['facts', 'details'] as const)('matches the intake %s protection trigger', group => {
    const name = `events_protect_intake_${group}`
    const sql = trigger(name)
    const expected = eventColumnsWith('protection', group)
    // The facts trigger runs on any update. Both bodies use the stored field list to decide whether to restore a fact.
    if (group === 'facts') expect(sql).toMatch(/\bAFTER\s+UPDATE\s+ON\s+events\b/i)
    else expectColumns(updateOf(name), expected, name)
    const guarded = [...sql.matchAll(/\binstr\((?:p\.)?k,\s*',([a-z_]+),'\)\s*>\s*0\s+AND\s+NEW\.\1\s+IS\s+NOT\s+OLD\.\1/gi)]
      .map(match => match[1]!)
    expectColumns(guarded, expected, `${name} change checks`)
    expectColumns(updateColumns(sql, name), expected, `${name} restored columns`)
  })

  it('rejects an unsupported SET target rather than skipping it', () => {
    const sql = "UPDATE events SET name = coalesce(?, 'a,b'), (price, is_free) = (0, 1) WHERE id = ?"
    expect(() => updateColumns(sql, 'events')).toThrow('cannot parse SET assignment: (price, is_free) = (0, 1)')
  })

  it('matches the column lists in the literal intake commit statements', () => {
    const insert = /^INSERT INTO events\s*\(([^)]+)\)\s*VALUES/i.exec(INSERT_INTAKE_EVENT)?.[1] ?? ''
    expectColumns(commaList(insert), eventColumnsWith('intakeWrite', 'create', 'both'), 'intake INSERT')
    expectColumns(updateColumns(UPDATE_INTAKE_EVENT, 'intake UPDATE'), eventColumnsWith('intakeWrite', 'both'), 'intake UPDATE')
    const facts = new Set<string>(eventColumnsWith('protection', 'facts'))
    expect(eventColumnsWith('protectOnCommit', true).filter(column => !facts.has(column))).toEqual([])
  })

  it('matches the column list in the literal publisher fix snapshot', () => {
    const sql = catalogRowSql('00000000-0000-4000-8000-000000000001')
    const snapshot = /^SELECT e\.id, (.*?), v\.name AS venue\b/i.exec(sql)?.[1] ?? ''
    expectColumns(commaList(snapshot).map(column => column.replace(/^e\./, '')),
      eventColumnsWith('publisherSnapshot', true), 'publisher fix snapshot')
  })

  it('matches the event fields that the search document builder reads', () => {
    const event: EmbeddingEventData = {
      name: 'Synthetic Jazz', description_es: 'Música en vivo', description_en: 'Live music',
      categories: ['music'], facets: EMPTY_FACETS, venue_name: 'Sala Sintética', venue_neighborhood: 'Boedo',
      price: 1000, is_free: false,
    }
    const reads = new Set<string>()
    const track = (key: string | symbol) => {
      if (typeof key === 'string') reads.add(key === 'venue_name' || key === 'venue_neighborhood' ? 'venue_id' : key)
    }
    buildSearchDocument(new Proxy(event, {
      get(target, key, receiver) { track(key); return Reflect.get(target, key, receiver) },
      has(target, key) { track(key); return Reflect.has(target, key) },
    }))
    expectColumns([...reads], eventColumnsWith('searchDocument', true), 'search document inputs')
  })
})
