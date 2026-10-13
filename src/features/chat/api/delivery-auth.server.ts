import {
	DELIVERY_AUTH_HEADER, DELIVERY_OWNER_HEADER, DELIVERY_TIME_HEADER, DELIVERY_TURN_HEADER,
	parseDeliveryIdentity,
} from '#features/chat/lib/delivery-protocol.ts'
import { EXECUTION_FENCE_HEADER, EXECUTION_STAGE_HEADER } from '../../../chat-delivery-worker/recovery.ts'

function signedValue(headers: Headers): string {
	const identity = parseDeliveryIdentity(headers.get(DELIVERY_TURN_HEADER), headers)
	if (!identity) throw new Error('Invalid chat delivery identity')
	const value: unknown[] = [identity.turnId, identity.attemptId, identity.token,
		headers.get(DELIVERY_OWNER_HEADER), headers.get(DELIVERY_TIME_HEADER)]
	if (headers.has(EXECUTION_FENCE_HEADER)) value.push(headers.get(EXECUTION_FENCE_HEADER), headers.get(EXECUTION_STAGE_HEADER))
	return JSON.stringify(value)
}

async function key(secret: string) {
	return crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

/** Private service request authentication; never returned to the browser or stored in the log. */
export async function signChatExecution(headers: Headers, secret: string): Promise<void> {
	headers.set(DELIVERY_TIME_HEADER, String(Date.now()))
	const signature = await crypto.subtle.sign('HMAC', await key(secret), new TextEncoder().encode(signedValue(headers)))
	headers.set(DELIVERY_AUTH_HEADER, Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join(''))
}

export async function verifyChatExecution(headers: Headers, secret: string | undefined): Promise<boolean> {
	const signature = headers.get(DELIVERY_AUTH_HEADER)
	const time = Number(headers.get(DELIVERY_TIME_HEADER))
	if (!secret || !signature || !/^[0-9a-f]{64}$/.test(signature) || !Number.isFinite(time) ||
		Math.abs(Date.now() - time) > 120_000) return false
	try {
		return await crypto.subtle.verify('HMAC', await key(secret),
			Uint8Array.from(signature.match(/../g)!, (byte) => parseInt(byte, 16)),
			new TextEncoder().encode(signedValue(headers)))
	} catch { return false }
}
