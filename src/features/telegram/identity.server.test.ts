import { describe, expect, it } from 'vitest'
import { hashTelegramIdentity } from './identity.server.ts'

describe('Telegram external identity hashing', () => {
  it('uses deterministic keyed HMAC-SHA256 with domain separation', () => {
    const secret = 't'.repeat(32)
    expect(hashTelegramIdentity('123456789', secret)).toMatch(/^[a-f0-9]{64}$/)
    expect(hashTelegramIdentity('123456789', secret)).toBe(
      hashTelegramIdentity('123456789', secret),
    )
    expect(hashTelegramIdentity('123456789', 'a'.repeat(32))).not.toBe(
      hashTelegramIdentity('123456789', secret),
    )
  })

  it('rejects invalid identities and secrets shorter than 32 bytes', () => {
    expect(() => hashTelegramIdentity('1e9', 's'.repeat(32))).toThrow('Invalid Telegram user ID')
    expect(() => hashTelegramIdentity('123', 'é'.repeat(15))).toThrow(
      'Telegram identity secret must be at least 32 bytes',
    )
  })
})
