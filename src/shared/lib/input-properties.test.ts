import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { normalizeText } from './utils/normalize-text'
import { openTelegramEnvelope, sealTelegramEnvelope } from '../../features/telegram/envelope.server'

const options = { numRuns: 500, seed: Number(process.env.FC_SEED ?? 20261031) }
const key = Buffer.alloc(32, 7).toString('base64')

describe('generated input invariants', () => {
  it('normalization produces stable tokens for arbitrary Unicode text', () => {
    fc.assert(fc.property(fc.string({ unit: 'grapheme' }), (value) => {
      const normalized = normalizeText(value)
      expect(normalizeText(normalized)).toBe(normalized)
      expect(normalized).toMatch(/^[a-z0-9]*(?: [a-z0-9]+)*$/)
    }), options)
  })
  it('encrypted handoffs preserve JSON and reject a different routing identity', () => {
    fc.assert(fc.property(fc.jsonValue(), fc.uuid(), fc.uuid(), (value, updateId, queueKey) => {
      const sealed = sealTelegramEnvelope(value, key, updateId, queueKey)
      expect(openTelegramEnvelope(sealed, key, updateId, queueKey)).toEqual(JSON.parse(JSON.stringify(value)))
      expect(() => openTelegramEnvelope(sealed, key, `${updateId}-other`, queueKey)).toThrow()
      expect(() => openTelegramEnvelope(sealed, key, updateId, `${queueKey}-other`)).toThrow()
    }), options)
  })
  it('changing any ciphertext byte invalidates its authentication tag', () => {
    fc.assert(fc.property(fc.jsonValue(), fc.nat(), (value, position) => {
      const sealed = sealTelegramEnvelope(value, key, 'update-1', 'queue-1')
      const packed = Buffer.from(sealed, 'base64')
      packed[position % packed.length] ^= 1
      expect(() => openTelegramEnvelope(packed.toString('base64'), key, 'update-1', 'queue-1')).toThrow()
    }), options)
  })
})
