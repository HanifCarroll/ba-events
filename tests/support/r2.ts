import type { R2Bucket } from '@cloudflare/workers-types'

/**
 * An in-memory stand-in for an R2 bucket binding: the calls the intake makes (put, get, list). Like R2, a put with a
 * `sha256` the bytes don't match is refused. `objects` holds the stored bytes by key.
 */
export function fakeR2(): R2Bucket & { objects: Map<string, Uint8Array> } {
	const objects = new Map<string, Uint8Array>()
	const types = new Map<string, string | undefined>()
	const bytesOf = async (value: unknown) => value instanceof Uint8Array ? new Uint8Array(value)
		: value instanceof ArrayBuffer ? new Uint8Array(value.slice(0)) : new Uint8Array(await new Response(value as BodyInit).arrayBuffer())
	const hex = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))]
		.map((byte) => byte.toString(16).padStart(2, '0')).join('')
	const bucket = {
		objects,
		async put(key: string, value: unknown, options?: { sha256?: string; httpMetadata?: { contentType?: string } }) {
			const bytes = await bytesOf(value)
			if (options?.sha256 && options.sha256 !== await hex(bytes)) throw new Error('put: The SHA-256 checksum you specified did not match what we received.')
			objects.set(key, bytes)
			types.set(key, options?.httpMetadata?.contentType)
			return { key }
		},
		async get(key: string) {
			const bytes = objects.get(key)
			if (!bytes) return null
			return { key, body: new Response(bytes as Uint8Array<ArrayBuffer>).body, httpMetadata: { contentType: types.get(key) },
				arrayBuffer: async () => bytes.slice().buffer }
		},
		async list() { return { objects: [...objects.keys()].map((key) => ({ key })), truncated: false } },
	}
	return bucket as unknown as R2Bucket & { objects: Map<string, Uint8Array> }
}
