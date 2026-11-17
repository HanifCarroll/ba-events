import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PLACEHOLDER, PRODUCTION_CONFIGS, unfilledConfigs } from './check-production-bindings.ts'

const repo = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const config = (id: string) => `{ "d1_databases": [{ "binding": "DB", "database_name": "baeventos-production", "database_id": "${id}" }] }`
const ID = '11111111-2222-4333-8444-555555555555'

describe('production D1 binding guard (synthetic configs)', () => {
  it('refuses the placeholder', () => {
    expect(unfilledConfigs(() => config(PLACEHOLDER))).toHaveLength(PRODUCTION_CONFIGS.length)
  })

  it('passes when every config has the same real id', () => {
    expect(unfilledConfigs(() => config(ID))).toEqual([])
  })

  it('refuses configs with different ids, and a config without the binding', () => {
    expect(unfilledConfigs((file) => config(file === 'wrangler.jsonc' ? ID.replace('1', '9') : ID)))
      .toEqual(['the production configs bind different database ids'])
    expect(unfilledConfigs((file) => file === 'wrangler.mcp.jsonc' ? '{}' : config(ID)))
      .toEqual(['wrangler.mcp.jsonc: no baeventos-production D1 binding'])
  })
})

describe('checked-in production configs', () => {
  it('bind baeventos-production and Vectorize, never a -staging resource (placeholder or filled in)', () => {
    for (const file of PRODUCTION_CONFIGS) {
      expect(repo(file)).toMatch(/"database_name":\s*"baeventos-production"/)
      expect(repo(file)).toContain('"index_name": "baeventos-events"')
      expect(repo(file)).not.toContain('-staging')
    }
    // Only placeholder or one shared id problems are allowed here, so CI passes in both the held and the filled state.
    const problems = unfilledConfigs(repo)
    expect(problems.every((problem) => problem.endsWith('database_id is still the placeholder'))).toBe(true)
    expect(repo('wrangler.chat.jsonc')).not.toContain('d1_databases')
  })
})
