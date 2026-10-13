import { Schema } from 'effect'

export const DELIVERY_ATTEMPT_HEADER = 'x-chat-attempt'
export const DELIVERY_TOKEN_HEADER = 'x-chat-token'
export const DELIVERY_OWNER_HEADER = 'x-chat-owner'
export const DELIVERY_TURN_HEADER = 'x-chat-turn'
export const DELIVERY_AUTH_HEADER = 'x-chat-execution-auth'
export const DELIVERY_TIME_HEADER = 'x-chat-execution-time'
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
	return `/api/chat/${identity.turnId}/stream?after=${after}`
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
