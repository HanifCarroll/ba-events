import { describe, expect, it } from 'vitest'
import {
  createTelegramEnvelopeKey,
  openTelegramEnvelope,
  sealTelegramEnvelope,
} from './envelope.server.ts'

const updateId = '42'
const queueKey = '11111111-1111-4111-8111-111111111111'

describe('Telegram sealed envelope', () => {
  it('round-trips with a bound update and queue key', () => {
    const key = createTelegramEnvelopeKey()
    const plaintext = { identityHash: 'a'.repeat(64), chatId: '1', text: 'hola' }
    const sealed = sealTelegramEnvelope(plaintext, key, updateId, queueKey)

    expect(openTelegramEnvelope(sealed, key, updateId, queueKey)).toEqual(plaintext)
    expect(sealed).not.toContain('hola')
  })

  it('rejects tampering and mismatched associated data', () => {
    const key = createTelegramEnvelopeKey()
    const sealed = sealTelegramEnvelope({ text: 'secret' }, key, updateId, queueKey)
    const bytes = Buffer.from(sealed, 'base64')
    bytes[bytes.length - 1] ^= 1

    expect(() => openTelegramEnvelope(bytes.toString('base64'), key, updateId, queueKey)).toThrow()
    expect(() => openTelegramEnvelope(sealed, key, '43', queueKey)).toThrow()
  })
})
