import { Schema } from 'effect'

export type RequestEnvelope = { url: string; headers: [string, string][]; body: string }
export type SealedEnvelope = { iv: string; ciphertext: string }
const encoder = new TextEncoder()
const envelopeSchema = Schema.Struct({ url: Schema.String, headers: Schema.Array(Schema.Tuple([Schema.String, Schema.String])), body: Schema.String })
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
const unhex = (value: string) => Uint8Array.from(value.match(/../g) ?? [], byte => parseInt(byte, 16))
async function encryptionKey(secret: string) {
 const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey'])
 return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('ba-events-chat'), info: encoder.encode('recovery-request-v1') }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}
/** Session credentials and the delivery capability are encrypted separately from the replay log. */
export async function sealEnvelope(envelope: RequestEnvelope, secret: string, name: string): Promise<SealedEnvelope> {
 const iv = crypto.getRandomValues(new Uint8Array(12))
 const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(name) }, await encryptionKey(secret), encoder.encode(JSON.stringify(envelope)))
 return { iv: hex(iv), ciphertext: hex(new Uint8Array(ciphertext)) }
}
export async function openEnvelope(envelope: SealedEnvelope, secret: string, name: string): Promise<RequestEnvelope> {
 const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(envelope.iv), additionalData: encoder.encode(name) }, await encryptionKey(secret), unhex(envelope.ciphertext))
 const decoded = Schema.decodeUnknownResult(envelopeSchema)(JSON.parse(new TextDecoder().decode(plaintext)))
 if (decoded._tag !== 'Success') throw new Error('Invalid recovery request')
 return { ...decoded.success, headers: decoded.success.headers.map(pair => [pair[0], pair[1]]) }
}
