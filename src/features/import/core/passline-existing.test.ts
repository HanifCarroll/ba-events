import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchExistingPasslineEvents } from './passline-existing.ts'

type QueryLike = {
  data: unknown[] | null
  error: { message: string } | null
}

function fakeClient(response: QueryLike) {
  const in_ = vi.fn(() => Promise.resolve(response))
  const eq = vi.fn(() => ({ in: in_ }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { client: { from } as unknown as SupabaseClient, from, select, eq, in_ }
}

describe('fetchExistingPasslineEvents', () => {
  it('returns an empty map without querying when there are no ids', async () => {
    const { from } = fakeClient({ data: [], error: null })
    const result = await fetchExistingPasslineEvents(
      { from } as unknown as SupabaseClient,
      []
    )
    expect(result.size).toBe(0)
    expect(from).not.toHaveBeenCalled()
  })

  it('throws on a Supabase query error instead of treating lookup failure as all-new', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'connection refused' } })
    await expect(fetchExistingPasslineEvents(client, ['1'])).rejects.toThrow(
      'Failed to fetch existing Passline events: connection refused'
    )
  })

  it('maps returned rows by external_id', async () => {
    const { client } = fakeClient({
      data: [
        { external_id: '1', id: 'row-1', name: 'A' },
        { external_id: '2', id: 'row-2', name: 'B' },
        { external_id: null, id: 'row-3', name: 'C' },
      ],
      error: null,
    })
    const result = await fetchExistingPasslineEvents(client, ['1', '2'])
    expect(result.size).toBe(2)
    expect(result.get('1')?.id).toBe('row-1')
    expect(result.get('2')?.id).toBe('row-2')
  })
  it('looks up the complete restored catalog in bounded chunks instead of truncating at a database row cap', async () => {
    const groups: string[][] = []
    const client = { from: () => ({ select: () => ({ eq: () => ({ in: async (_column: string, ids: string[]) => {
      groups.push(ids)
      return { data: ids.map(external_id => ({ external_id, id: `row-${external_id}` })), error: null }
    } }) }) }) } as unknown as SupabaseClient
    const ids = Array.from({ length: 1245 }, (_, index) => String(index))
    const result = await fetchExistingPasslineEvents(client, ids)
    expect(groups.map(group => group.length)).toEqual([250, 250, 250, 250, 245])
    expect(result.size).toBe(1245)
    expect(result.get('1244')?.id).toBe('row-1244')
  })

})
