import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const IV_BYTES = 12
const TAG_BYTES = 16

export function createTelegramEnvelopeKey(): string {
  return randomBytes(32).toString('base64')
}

function keyBytes(key: string): Buffer {
  const bytes = Buffer.from(key, 'base64')
  if (bytes.length !== 32 || bytes.toString('base64') !== key) {
    throw new Error('Invalid Telegram envelope key')
  }
  return bytes
}

function aad(updateId: string, queueKey: string): Buffer {
  return Buffer.from(`telegram:v1:${updateId}:${queueKey}`)
}

export function sealTelegramEnvelope(
  plaintext: unknown,
  key: string,
  updateId: string,
  queueKey: string
): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv)
  cipher.setAAD(aad(updateId, queueKey))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(plaintext), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')
}

export function openTelegramEnvelope(
  sealed: string,
  key: string,
  updateId: string,
  queueKey: string
): unknown {
  const packed = Buffer.from(sealed, 'base64')
  if (packed.length <= IV_BYTES + TAG_BYTES || packed.toString('base64') !== sealed) {
    throw new Error('Invalid Telegram sealed envelope')
  }
  const iv = packed.subarray(0, IV_BYTES)
  const tag = packed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
  const ciphertext = packed.subarray(IV_BYTES + TAG_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(key), iv)
  decipher.setAAD(aad(updateId, queueKey))
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  return JSON.parse(plaintext) as unknown
}
