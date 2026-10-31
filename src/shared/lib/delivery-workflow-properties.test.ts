import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { chatDeliveryFixture } from '../../../tests/support/chat-delivery-fixture.ts'

describe('durable delivery workflow properties', () => {
  it('keeps cancellation and ownership authoritative across duplicate requests and runtime restarts', async () => {
    await fc.assert(fc.asyncProperty(fc.boolean(), fc.array(fc.constantFrom('stop', 'attach', 'duplicate', 'changed', 'wrong-owner', 'wrong-token', 'wrong-owner-start', 'wrong-token-start', 'restart'), { minLength: 1, maxLength: 25 }), async (stopFirst, history) => {
      const fixture = chatDeliveryFixture()
      let cancelled = stopFirst
      const first = await fixture.object.fetch(fixture.request(stopFirst ? 'stop' : 'start'))
      expect(first.status).toBe(stopFirst ? 204 : 200)
      await first.body?.cancel()
      await Promise.all(fixture.tasks)
      for (const action of history) {
        if (action === 'restart') { fixture.restart(); continue }
        const before = { storage: structuredClone([...fixture.values]), admissions: fixture.admissions }
        const request = action === 'stop' ? fixture.request('stop')
          : action === 'duplicate' ? fixture.request('start')
          : action === 'changed' ? fixture.request('start', { body: '{"message":"Changed question"}' })
          : action === 'wrong-owner-start' ? fixture.request('start', { owner: 'another-owner' })
          : action === 'wrong-token-start' ? fixture.request('start', { token: 'b'.repeat(64) })
          : fixture.request('stream', action === 'wrong-owner' ? { owner: 'another-owner' } : action === 'wrong-token' ? { token: 'b'.repeat(64) } : {})
        const response = await fixture.object.fetch(request)
        expect(response.status).toBe(action === 'wrong-owner' || action === 'wrong-token' ? 403
          : action === 'changed' || action === 'wrong-owner-start' || action === 'wrong-token-start' || action === 'duplicate' && stopFirst ? 409 : action === 'stop' ? 204 : 200)
        if (!response.ok) {
          expect([...fixture.values]).toEqual(before.storage)
          expect(fixture.admissions).toBe(before.admissions)
        }
        await response.body?.cancel()
        if (action === 'stop') cancelled = true
        const stored = fixture.values.get('metadata') as { phase: string; owner: string }
        expect(stored.phase).toBe(cancelled ? 'cancelled' : 'running')
        expect(stored.owner).toBe(fixture.owner)
        expect(JSON.stringify([...fixture.values])).not.toContain(fixture.identity.token)
        expect(fixture.admissions).toBe(stopFirst ? 0 : 1)
      }
      await fixture.object.fetch(fixture.request('stop'))
      await Promise.all(fixture.tasks)
    }), { examples: [[false, ['wrong-owner-start', 'wrong-token-start', 'duplicate', 'stop', 'wrong-owner-start', 'wrong-token-start']], [true, ['wrong-owner-start', 'wrong-token-start', 'duplicate']]], numRuns: 80, seed: Number(process.env.FC_SEED ?? 20261031) })
  })
})
