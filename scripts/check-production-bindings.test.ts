import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PLACEHOLDER, PRODUCTION_CONFIGS, unfilledConfigs } from './check-production-bindings.ts'

const repo = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

describe('production D1 binding guard', () => {
  it('refuses the committed placeholder, so a merge before the database exists cannot deploy', () => {
    expect(unfilledConfigs(repo)).toHaveLength(PRODUCTION_CONFIGS.length)
  })

  it('passes once every config has the same real id, and catches a mismatch', () => {
    const id = '11111111-2222-4333-8444-555555555555'
    expect(unfilledConfigs((file) => repo(file).replaceAll(PLACEHOLDER, id))).toEqual([])
    const mixed = (file: string) => repo(file).replaceAll(PLACEHOLDER, file === 'wrangler.jsonc' ? id.replace('1', '9') : id)
    expect(unfilledConfigs(mixed)).toEqual(['the production configs bind different database ids'])
  })

  it('binds every production Worker that reads the database, never a -staging resource', () => {
    for (const file of PRODUCTION_CONFIGS) {
      expect(repo(file)).toContain('"index_name": "baeventos-events"')
      expect(repo(file)).not.toContain('-staging')
    }
    expect(repo('wrangler.chat.jsonc')).not.toContain('d1_databases')
  })
})
