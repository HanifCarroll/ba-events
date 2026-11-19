import { createHash } from 'crypto'
import { requireD1 } from '#shared/lib/db/d1-binding.server.ts'
import { checkRateLimitD1 } from '#shared/lib/db/rate-limit-d1.server.ts'

// Rate limit configuration for chat/general use
export const RATE_LIMIT_REQUESTS = 50
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

// Rate limit configuration for external API
export const API_RATE_LIMIT_REQUESTS = 10
export const API_RATE_LIMIT_WINDOW_MS = 60 * 1000

export class RateLimitUnavailableError extends Error {
	override name = 'RateLimitUnavailableError'
	constructor() { super('Rate limit service temporarily unavailable.') }
}
export const RATE_LIMIT_RETRY_SECONDS = 30
const RATE_LIMIT_TIMEOUT_MS = 3_000

const warnedMessages = new Set<string>()

function warnRateLimitOnce(message: string) {
	if (warnedMessages.has(message)) return
	warnedMessages.add(message)
	console.warn(message)
}

function hashIdentifier(scope: string, identifier: string): string {
	return createHash('sha256')
		.update(`${scope}:${identifier}`)
		.digest('hex')
}

async function checkScopedRateLimit(
	scope: string,
	identifier: string,
	maxRequests: number,
	windowMs: number,
): Promise<{
	success: boolean
	remaining: number
	reset: number
}> {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000))
		const { success, remaining, reset } = await Promise.race([
			checkRateLimitD1(requireD1(), scope, hashIdentifier(scope, identifier), maxRequests, windowSeconds),
			new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), RATE_LIMIT_TIMEOUT_MS) }),
		])
		return { success, remaining, reset }
	} catch {
		warnRateLimitOnce(`[rate-limit] Rate limit unavailable for scope "${scope}". Blocking requests.`)
		throw new RateLimitUnavailableError()
	} finally {
		clearTimeout(timer)
	}
}

export async function checkRateLimit(ip: string): Promise<{
	success: boolean
	remaining: number
	reset: number
}> {
	return checkScopedRateLimit('chat', ip || 'unknown-ip', RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW_MS)
}

export async function checkApiRateLimit(ip: string): Promise<{
	success: boolean
	remaining: number
	reset: number
}> {
	return checkScopedRateLimit(
		'public_api',
		ip || 'unknown-ip',
		API_RATE_LIMIT_REQUESTS,
		API_RATE_LIMIT_WINDOW_MS,
	)
}
