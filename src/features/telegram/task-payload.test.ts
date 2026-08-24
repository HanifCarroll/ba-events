import { describe, expect, it } from 'vitest'
import { telegramPlaintextPayloadSchema } from './task-payload.ts'

const base = { identityHash: 'a'.repeat(64), chatId: '123' }

describe('Telegram plaintext task payload', () => {
  it.each([
    { ...base, text: 'events tonight' },
    { ...base, rateLimited: true },
    { ...base, callbackId: 'callback-1', callbackData: 'prompt:v1:chill' },
    { ...base, callbackId: 'callback-1', callbackData: 'prompt:v1:chill', rateLimited: true },
  ])('accepts one valid delivery shape', (payload) => {
    expect(telegramPlaintextPayloadSchema.safeParse(payload).success).toBe(true)
  })

  it.each([
    base,
    { ...base, callbackId: 'callback-1' },
    { ...base, text: 'events tonight', rateLimited: true },
    { ...base, callbackId: 'callback-1', callbackData: 'consent:v1:accept', rateLimited: true },
  ])('rejects ambiguous or incomplete delivery shapes', (payload) => {
    expect(telegramPlaintextPayloadSchema.safeParse(payload).success).toBe(false)
  })
})
