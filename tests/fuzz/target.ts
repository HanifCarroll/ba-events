import assert from 'node:assert/strict'
import { normalizeText } from '../../src/shared/lib/utils/normalize-text'
import { openTelegramEnvelope, sealTelegramEnvelope } from '../../src/features/telegram/envelope.server'

// Synthetic key only; never read deployment configuration in a fuzz target.
const key = Buffer.alloc(32, 7).toString('base64')
export function fuzz(data: Buffer) {
  const text = data.toString('utf8')
  const normalized = normalizeText(text)
  assert.equal(normalizeText(normalized), normalized)
  assert.match(normalized, /^[a-z0-9]*(?: [a-z0-9]+)*$/)
  const sealed = sealTelegramEnvelope({ text }, key, 'update-1', 'queue-1')
  assert.deepEqual(openTelegramEnvelope(sealed, key, 'update-1', 'queue-1'), { text })
  assert.throws(() => openTelegramEnvelope(sealed, key, 'update-2', 'queue-1'))
  const tampered = Buffer.from(sealed, 'base64')
  tampered[tampered.length - 1] ^= 1
  assert.throws(() => openTelegramEnvelope(tampered.toString('base64'), key, 'update-1', 'queue-1'))
}
