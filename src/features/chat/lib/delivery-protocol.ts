import { Schema } from 'effect'
import type { CanonicalChatResponse, MessageExecutionStep } from '#shared/lib/types.ts'
import { canonicalFromDataResponse } from './canonical.ts'

export const DELIVERY_ATTEMPT_HEADER = 'x-chat-attempt'
export const DELIVERY_TOKEN_HEADER = 'x-chat-token'
export const DELIVERY_OWNER_HEADER = 'x-chat-owner'
export const DELIVERY_TURN_HEADER = 'x-chat-turn'
export const DELIVERY_AUTH_HEADER = 'x-chat-execution-auth'
export const DELIVERY_TIME_HEADER = 'x-chat-execution-time'
export const DELIVERY_CLIENT_IP_HEADER = 'x-chat-client-ip'
export const EXECUTION_FENCE_HEADER = 'x-chat-execution-fence'
export const EXECUTION_STAGE_HEADER = 'x-chat-execution-stage'
const WORKFLOW_TIME_HEADER = 'x-chat-workflow-time'
const WORKFLOW_AUTH_HEADER = 'x-chat-workflow-auth'

export const CHAT_EXECUTION_PATH = '/api/chat/execute'
export const DELIVERY_PATH = {
	start: '/start', stream: '/stream', stop: '/stop', commit: '/commit', checkpoint: '/checkpoint',
} as const
const DELIVERY_ORIGIN = 'https://chat-delivery'
export const DELIVERY_OFFSET_PARAM = 'after'

export interface ChatDeliveryNamespace {
	idFromName(name: string): unknown
	get(id: unknown): { fetch(request: Request): Promise<Response> }
}

export function deliveryBindingUrl(action: keyof typeof DELIVERY_PATH): string {
	return DELIVERY_ORIGIN + DELIVERY_PATH[action]
}

export function chatExecutionUrl(requestUrl: string): URL {
	const url = new URL(requestUrl)
	url.pathname = CHAT_EXECUTION_PATH
	url.search = ''
	return url
}

export type ExecutionStage = 'generate' | 'commit' | 'fail'
export type RecoveryCheckpoint = { canonical: CanonicalChatResponse; executionTrace: MessageExecutionStep[]; providerRequestId?: string }

const encoder = new TextEncoder()
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
const unhex = (value: string) => Uint8Array.from(value.match(/../g) ?? [], byte => parseInt(byte, 16))

export const DELIVERY_RETENTION_MS = 10 * 60_000
export const DELIVERY_RUN_TIMEOUT_MS = 90_000

const uuid = Schema.String.pipe(Schema.refine((value): value is string =>
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)))
const identitySchema = Schema.Struct({
	turnId: uuid,
	attemptId: uuid,
	token: Schema.String.pipe(Schema.refine((value): value is string => /^[0-9a-f]{64}$/.test(value))),
})

export type DeliveryIdentity = typeof identitySchema.Type

export function parseDeliveryIdentity(turnId: unknown, headers: Headers): DeliveryIdentity | null {
	const result = Schema.decodeUnknownResult(identitySchema)({
		turnId, attemptId: headers.get(DELIVERY_ATTEMPT_HEADER), token: headers.get(DELIVERY_TOKEN_HEADER),
	})
	return result._tag === 'Success' ? result.success : null
}

export function deliveryHeaders(identity: DeliveryIdentity): Record<string, string> {
	return { [DELIVERY_ATTEMPT_HEADER]: identity.attemptId, [DELIVERY_TOKEN_HEADER]: identity.token }
}

export function deliveryObjectName(identity: Pick<DeliveryIdentity, 'turnId' | 'attemptId'>): string {
	return `${identity.turnId}:${identity.attemptId}`
}

export function deliveryStreamUrl(identity: DeliveryIdentity, after = -1): string {
	return `/api/chat/${identity.turnId}${DELIVERY_PATH.stream}?${DELIVERY_OFFSET_PARAM}=${after}`
}

const checkpointSchema = Schema.Struct({
	canonical: Schema.Unknown,
	executionTrace: Schema.Array(Schema.Unknown),
	providerRequestId: Schema.optional(Schema.String),
})

export function encodeCheckpoint(checkpoint: RecoveryCheckpoint): string {
	return JSON.stringify(checkpoint)
}

export function checkpointResponse(checkpoint: RecoveryCheckpoint | null): Response {
	return Response.json(checkpoint)
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

function signedValue(headers: Headers): string {
	const identity = parseDeliveryIdentity(headers.get(DELIVERY_TURN_HEADER), headers)
	if (!identity) throw new Error('Invalid chat delivery identity')
	const value: unknown[] = [identity.turnId, identity.attemptId, identity.token,
		headers.get(DELIVERY_OWNER_HEADER), headers.get(DELIVERY_TIME_HEADER)]
	if (headers.has(EXECUTION_FENCE_HEADER)) value.push(headers.get(EXECUTION_FENCE_HEADER), headers.get(EXECUTION_STAGE_HEADER))
	return JSON.stringify(value)
}

async function signingKey(secret: string) {
	return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

/** Private service request authentication; never returned to the browser or stored in the log. */
export async function signChatExecution(headers: Headers, secret: string): Promise<void> {
	headers.set(DELIVERY_TIME_HEADER, String(Date.now()))
	const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(signedValue(headers)))
	headers.set(DELIVERY_AUTH_HEADER, hex(new Uint8Array(signature)))
}

export async function verifyChatExecution(headers: Headers, secret: string | undefined): Promise<boolean> {
	const signature = headers.get(DELIVERY_AUTH_HEADER)
	const time = Number(headers.get(DELIVERY_TIME_HEADER))
	if (!secret || !signature || !/^[0-9a-f]{64}$/.test(signature) || !Number.isFinite(time) ||
		Math.abs(Date.now() - time) > 120_000) return false
	try {
		return await crypto.subtle.verify('HMAC', await signingKey(secret), unhex(signature), encoder.encode(signedValue(headers)))
	} catch { return false }
}

/** Binding-only control requests authenticate the object name, action and stage, not stored credentials. */
export async function workflowRequest(secret: string, name: string, action: string, stage?: ExecutionStage): Promise<Request> {
	const url = new URL(DELIVERY_ORIGIN + '/' + action)
	url.searchParams.set('name', name)
	if (stage) url.searchParams.set('stage', stage)
	const time = String(Date.now())
	const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(url.pathname + url.search + ':' + time))
	return new Request(url, { method: 'POST', headers: { [WORKFLOW_TIME_HEADER]: time, [WORKFLOW_AUTH_HEADER]: hex(new Uint8Array(signature)) } })
}

export async function verifyWorkflowRequest(request: Request, secret: string): Promise<boolean> {
	const time = request.headers.get(WORKFLOW_TIME_HEADER)
	const signature = request.headers.get(WORKFLOW_AUTH_HEADER)
	if (!time || !signature || !/^[0-9a-f]{64}$/.test(signature) || Math.abs(Date.now() - Number(time)) > 120_000 || !Number.isFinite(Number(time))) return false
	const url = new URL(request.url)
	return crypto.subtle.verify('HMAC', await signingKey(secret), unhex(signature), encoder.encode(url.pathname + url.search + ':' + time))
}

export const DELIVERY_RECONNECT_HEADER = 'x-chat-reconnectable'
export const DELIVERY_RECONNECT_VERSION = '1'
export const DELIVERY_STREAM_HEADERS = {
	'content-type': 'text/event-stream', 'cache-control': 'no-store, no-transform',
	'x-vercel-ai-ui-message-stream': 'v1', [DELIVERY_RECONNECT_HEADER]: DELIVERY_RECONNECT_VERSION,
} as const
export const CHAT_DONE = '[DONE]'
export const CHAT_RESPONSE_CHUNK = 'data-response'
export const CHAT_PROGRESS_CHUNK = 'data-progress'

export function encodeChatEvent(data: string, sequence?: number): Uint8Array {
	return encoder.encode(`${sequence === undefined ? '' : `id: ${sequence}\n`}data: ${data}\n\n`)
}

export function encodeChatConnected(): Uint8Array {
	return encoder.encode(': connected\n\n')
}

/** SSE framing only. The AI SDK still validates each UIMessageChunk. */
export class ChatEventDecoder {
	private pending = ''
	push(text: string): string[] {
		this.pending = (this.pending + text).replace(/\r\n/g, '\n')
		const frames: string[] = []
		let boundary: number
		while ((boundary = this.pending.indexOf('\n\n')) !== -1) {
			frames.push(this.pending.slice(0, boundary))
			this.pending = this.pending.slice(boundary + 2)
		}
		if (this.pending.length > 256 * 1024) throw new Error('Chat event exceeds the delivery limit')
		return frames
	}
}

export function eventData(frame: string): string | null {
	const lines = frame.split('\n').filter((line) => line.startsWith('data:'))
	return lines.length ? lines.map((line) => line.slice(5).trimStart()).join('\n') : null
}

export function eventOffset(frame: string): number | null {
	const id = frame.split('\n').find((line) => line.startsWith('id:'))?.slice(3).trim()
	return id !== undefined && /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) ? Number(id) : null
}
