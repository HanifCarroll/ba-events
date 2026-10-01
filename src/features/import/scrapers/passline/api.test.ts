import { describe, it, expect } from 'vitest'
import fixture from './catalog-fixture.json'
import { collectPasslinePages } from './api.ts'

describe('complete Passline country acquisition', () => {
  it('passes a capped first page, a short page, and identical repeated IDs before requiring exhaustion', async () => {
    const calls: number[] = []
    const first = Array.from({ length: 200 }, (_, id) => ({ ...fixture, id: String(id) }))
    const result = await collectPasslinePages(async offset => {
      calls.push(offset)
      return offset === 0 ? first : offset === 200 ? [first[0], { ...fixture, id: 'beyond-home-feed' }] : []
    })
    expect(calls).toEqual([0, 200, 202])
    expect(result).toHaveLength(201)
    expect(result.at(-1)?.id).toBe('beyond-home-feed')
  })
  it('fails malformed, conflicting, and nonterminating catalogs instead of returning partial success', async () => {
    await expect(collectPasslinePages(async offset => offset ? [{}] : [fixture])).rejects.toThrow('Malformed')
    await expect(collectPasslinePages(async offset => offset ? [{ ...fixture, nombre: 'Changed during scan' }] : [fixture])).rejects.toThrow('Conflicting')
    await expect(collectPasslinePages(async () => [fixture], 2)).rejects.toThrow('safety bound')
  })
})
