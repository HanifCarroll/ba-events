import { Schema } from 'effect'
import { canonicalFromDataResponse } from '#features/chat/lib/canonical.ts'
import type { CanonicalChatResponse, MessageExecutionStep } from '#shared/lib/types.ts'

export const EXECUTION_FENCE_HEADER = 'x-chat-execution-fence'
export const EXECUTION_STAGE_HEADER = 'x-chat-execution-stage'
export type ExecutionStage = 'generate' | 'commit' | 'fail'
export type RecoveryCheckpoint = { canonical: CanonicalChatResponse; executionTrace: MessageExecutionStep[]; providerRequestId?: string }
export type RequestEnvelope = { url: string; headers: [string, string][]; body: string }
export type SealedEnvelope = { iv: string; ciphertext: string }
const encoder = new TextEncoder()
const envelopeSchema = Schema.Struct({ url: Schema.String, headers: Schema.Array(Schema.Tuple([Schema.String, Schema.String])), body: Schema.String })
const checkpointSchema = Schema.Struct({ canonical: Schema.Unknown, executionTrace: Schema.Array(Schema.Unknown), providerRequestId: Schema.optional(Schema.String) })
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
export function parseCheckpoint(input: unknown): RecoveryCheckpoint | null {
 const decoded = Schema.decodeUnknownResult(checkpointSchema)(input)
 if (decoded._tag !== 'Success') return null
 const canonical = canonicalFromDataResponse(decoded.success.canonical)
 return canonical ? { ...decoded.success, canonical, executionTrace: decoded.success.executionTrace as MessageExecutionStep[] } : null
}
function sorted(value: unknown): unknown {
 if (Array.isArray(value)) return value.map(sorted)
 if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sorted(item)]))
 return value
}
export const canonicalKey = (value: unknown) => JSON.stringify(sorted(value))
async function workflowKey(secret: string) {
 return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}
/** Binding-only control requests authenticate the object name, action and stage, not stored credentials. */
export async function workflowRequest(secret: string, name: string, action: string, stage?: ExecutionStage): Promise<Request> {
 const url = new URL('https://chat-delivery/' + action); url.searchParams.set('name', name)
 if (stage) url.searchParams.set('stage', stage)
 const time = String(Date.now())
 const signature = await crypto.subtle.sign('HMAC', await workflowKey(secret), encoder.encode(url.pathname + url.search + ':' + time))
 return new Request(url, { method: 'POST', headers: { 'x-chat-workflow-time': time, 'x-chat-workflow-auth': hex(new Uint8Array(signature)) } })
}
export async function verifyWorkflowRequest(request: Request, secret: string): Promise<boolean> {
 const time = request.headers.get('x-chat-workflow-time'); const signature = request.headers.get('x-chat-workflow-auth')
 if (!time || !signature || !/^[0-9a-f]{64}$/.test(signature) || Math.abs(Date.now() - Number(time)) > 120_000 || !Number.isFinite(Number(time))) return false
 const url = new URL(request.url)
 return crypto.subtle.verify('HMAC', await workflowKey(secret), unhex(signature), encoder.encode(url.pathname + url.search + ':' + time))
}
