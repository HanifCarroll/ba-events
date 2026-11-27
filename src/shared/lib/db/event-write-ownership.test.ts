import { readFileSync, readdirSync } from 'node:fs'
import { expect, it } from 'vitest'

const owner = 'src/shared/lib/db/event-write.ts'
const scopeWriter = 'src/features/events/scope/catalog.ts'
const authority = /\b(?:write_context|intakeCommitBatch|event_intake_protection|publisher_catalog_fixes)\b/iu
const eventUpdate = /\bUPDATE(?:\s+OR\s+\w+)?\s+["`\[]?events["`\]]?(?:\s+(?:AS\s+)?\w+)?\s+SET\b/iu
const eventInsert = /\b(?:INSERT(?:\s+OR\s+\w+)?|REPLACE)\s+INTO\s+["`\[]?events\b/iu

it('reserves event facts, the intake ledger, bypass, and correction transport for the write gateway', () => {
  const violations = ['src', 'scripts', 'evals'].flatMap(root => readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && /\.(?:[cm]?[jt]sx?|svelte)$/u.test(entry.name) && !/\.(?:test|spec|d)\.[cm]?[jt]sx?$/u.test(entry.name))
    .map(entry => `${entry.parentPath}/${entry.name}`)
    .filter(path => path !== owner && !path.startsWith('src/lib/paraglide/'))
    .flatMap(path => {
      const source = readFileSync(path, 'utf8')
      // Scope owns only the registry's judgment and invalidation columns, which are not catalog facts.
      const sql = path === scopeWriter ? source.replace(/UPDATE events SET \$\{(?:retireJudgment|applyJudgment)\}/gu, '') : source
      return [authority.test(source) && `${path}: authority access`,
        (eventUpdate.test(sql) || eventInsert.test(sql)) && `${path}: direct event write`].filter(Boolean)
    }))
  expect(violations).toEqual([])
})
