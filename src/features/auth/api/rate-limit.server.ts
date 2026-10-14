import { createHash } from 'crypto'
import { Schema } from 'effect'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseServiceRoleClient } from '#shared/lib/db/service.server.ts'

// Rate limit configuration for chat/general use
export const RATE_LIMIT_REQUESTS = 50
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

// Rate limit configuration for external API
export const API_RATE_LIMIT_REQUESTS = 10
export const API_RATE_LIMIT_WINDOW_MS = 60 * 1000

const counter = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const rateLimitResultSchema = Schema.Struct({
	success: Schema.Boolean,
	remaining: counter,
	reset: counter,
	request_count: counter,
})

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
	providedClient?: SupabaseClient,
): Promise<{
	success: boolean
	remaining: number
	reset: number
}> {
	try {
		const client = providedClient ?? getSupabaseServiceRoleClient()
		const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000))
		const { data, error } = await client
			.rpc('check_rate_limit', {
				p_scope: scope,
				p_identifier_hash: hashIdentifier(scope, identifier),
				p_max_requests: maxRequests,
				p_window_seconds: windowSeconds
			})
			.abortSignal(AbortSignal.timeout(RATE_LIMIT_TIMEOUT_MS))
			.single()

		if (error) {
			throw error
		}

		const decoded = Schema.decodeUnknownResult(rateLimitResultSchema)(data)
		if (decoded._tag !== 'Success') throw new RateLimitUnavailableError()
		const result = decoded.success

		return {
			success: result.success,
			remaining: result.remaining,
			reset: result.reset
		}
	} catch {
		warnRateLimitOnce(`[rate-limit] Supabase rate limit unavailable for scope "${scope}". Blocking requests.`)
		throw new RateLimitUnavailableError()
	}
}

export async function checkRateLimit(ip: string, client?: SupabaseClient): Promise<{
	success: boolean
	remaining: number
	reset: number
}> {
	return checkScopedRateLimit('chat', ip || 'unknown-ip', RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW_MS, client)
}

export async function checkApiRateLimit(ip: string, client?: SupabaseClient): Promise<{
	success: boolean
	remaining: number
	reset: number
}> {
	return checkScopedRateLimit(
		'public_api',
		ip || 'unknown-ip',
		API_RATE_LIMIT_REQUESTS,
		API_RATE_LIMIT_WINDOW_MS,
		client,
	)
}
