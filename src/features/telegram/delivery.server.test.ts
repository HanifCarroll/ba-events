import { describe, expect, it, vi } from 'vitest'
import {
  claimTelegramUpdate,
  markTelegramUpdateCompleted,
  redactTelegramIdentityClaims,
} from './delivery.server.ts'

const identityHash = 'a'.repeat(64)

function terminalQuery(result: unknown) {
  const query: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'neq', 'update']) query[method] = vi.fn(() => query)
  query.single = vi.fn(async () => result)
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(result))
  return query
}

describe('Telegram delivery claims', () => {
  it('stores the identity link only in the service-role delivery claim', async () => {
    const insert = vi.fn(async () => ({ error: null }))
    const client = { from: vi.fn(() => ({ insert })) } as never
    await expect(claimTelegramUpdate('42', identityHash, client)).resolves.toMatchObject({
      completed: false,
      checkRateLimit: true,
    })
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ update_id: '42', identity_hash: identityHash })
    )
  })

  it.each([
    ['failed', true],
    ['processing', false],
  ] as const)(
    'reuses a %s row key and returns the correct rate-limit decision',
    async (status, checkRateLimit) => {
      const insert = vi.fn(async () => ({ error: { code: '23505' } }))
      const read = terminalQuery({
        data: { status, attempt_count: 2, identity_hash: identityHash, envelope_key: 'existing-key' },
        error: null,
      })
      const renew = terminalQuery({ error: null })
      let call = 0
      const client = {
        from: vi.fn(() => {
          call += 1
          if (call === 1) return { insert }
          return call === 2 ? read : renew
        }),
      } as never

      await expect(claimTelegramUpdate('42', identityHash, client)).resolves.toEqual({
        completed: false,
        envelopeKey: 'existing-key',
        checkRateLimit,
      })
      expect(renew.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'processing', attempt_count: 3 })
      )
    }
  )

  it('rejects a noncompleted duplicate claimed by another identity', async () => {
    const insert = vi.fn(async () => ({ error: { code: '23505' } }))
    const read = terminalQuery({
      data: {
        status: 'processing',
        attempt_count: 1,
        identity_hash: 'b'.repeat(64),
        envelope_key: 'existing-key',
      },
      error: null,
    })
    let call = 0
    const client = {
      from: vi.fn(() => (++call === 1 ? { insert } : read)),
    } as never
    await expect(claimTelegramUpdate('42', identityHash, client)).rejects.toThrow(
      'Telegram update identity mismatch'
    )
  })

  it('redacts every durable identity link and ciphertext key', async () => {
    const query = terminalQuery({ error: null })
    await redactTelegramIdentityClaims(identityHash, { from: vi.fn(() => query) } as never)
    expect(query.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        conversation_id: null,
        identity_hash: null,
        envelope_key: null,
        error_code: 'identity_redacted',
      })
    )
    expect(query.eq).toHaveBeenCalledWith('identity_hash', identityHash)
  })

  it('atomically clears the envelope key when completing delivery', async () => {
    const query = terminalQuery({ error: null })
    await markTelegramUpdateCompleted('42', 'conversation-1', {
      from: vi.fn(() => query),
    } as never)

    expect(query.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        conversation_id: 'conversation-1',
        envelope_key: null,
      })
    )
    expect(query.neq).toHaveBeenCalledWith('status', 'completed')
  })
})
