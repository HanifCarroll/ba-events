/** Better Auth on D1 with Cloudflare Email Sending. */
import { betterAuth } from 'better-auth'
import { parseSetCookieHeader, toCookieOptions } from 'better-auth/cookies'
import { magicLink } from 'better-auth/plugins'
import type { D1Database } from '@cloudflare/workers-types'
import type { RequestEvent } from '@sveltejs/kit'
import { Effect } from 'effect'
import type { Locale } from '#shared/lib/types.ts'
import { boundD1Database } from '#shared/lib/db/d1.server.ts'
import { MAGIC_LINK_MINUTES, sendMagicLinkEffect, type MagicLinkMailer } from './magic-link-email.server.ts'

export interface BetterAuthEnv {
	DB: D1Database
	AUTH_SECRET: string
	GOOGLE_CLIENT_ID?: string
	GOOGLE_CLIENT_SECRET?: string
	/** Cloudflare Email Sending binding; the magic-link sender must be in its allowed_sender_addresses. */
	EMAIL?: MagicLinkMailer
}

const SESSION_COOKIE = 'baeventos.session_token'
const localeOf = (value: unknown): Locale => (value === 'en' ? 'en' : 'es')

/** Tests only: replaces Google's token checks so linking can be tested without calling Google. */
export type GoogleTestOverrides = Pick<NonNullable<Parameters<typeof betterAuth>[0]['socialProviders']>, 'google'>['google'] & object

export function createBetterAuth(origin: string, env: BetterAuthEnv, googleTest?: GoogleTestOverrides) {
	const secure = origin.startsWith('https:')
	return betterAuth({
		database: env.DB,
		baseURL: origin,
		basePath: '/api/auth',
		secret: env.AUTH_SECRET,
		trustedOrigins: [origin],
		telemetry: { enabled: false },
		user: {
			modelName: 'users', fields: { emailVerified: 'email_verified', createdAt: 'created_at', updatedAt: 'updated_at' },
			// Better Auth would otherwise register an unknown Google email Google hasn't verified. This runs before any
			// user or account row is written; magic links pass because the link itself proves the email.
			validateUserInfo: ({ user, source }) =>
				source.method === 'oauth' && !user.emailVerified ? { error: 'email_not_verified', errorDescription: 'Google has not verified this email' } : undefined,
		},
		session: {
			modelName: 'sessions',
			fields: { userId: 'user_id', expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at', ipAddress: 'ip_address', userAgent: 'user_agent' },
			expiresIn: 30 * 86400,
			// Most requests read the signed cookie instead of D1; a sign-out or role change reaches other devices within a minute.
			cookieCache: { enabled: true, maxAge: 60 },
		},
		account: {
			modelName: 'accounts',
			fields: { userId: 'user_id', accountId: 'account_id', providerId: 'provider_id', accessToken: 'access_token', refreshToken: 'refresh_token', idToken: 'id_token', accessTokenExpiresAt: 'access_token_expires_at', refreshTokenExpiresAt: 'refresh_token_expires_at', createdAt: 'created_at', updatedAt: 'updated_at' },
			// A Google sign-in joins the existing (imported) user with the same email only when Google says that email is
			// verified and ours is too. No trusted providers: trusting Google would skip Google's own verified flag.
			accountLinking: { enabled: true, trustedProviders: [], requireLocalEmailVerified: true },
		},
		verification: { modelName: 'verification_tokens', fields: { expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at' } },
		rateLimit: { enabled: true, storage: 'database', modelName: 'auth_rate_limits', fields: { lastRequest: 'last_request' } },
		advanced: {
			useSecureCookies: secure,
			cookiePrefix: 'baeventos',
			cookies: { session_token: { name: SESSION_COOKIE } },
			database: { generateId: () => crypto.randomUUID() },
			ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
		},
		socialProviders: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
			? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, requireEmailVerification: true, ...googleTest } }
			: {},
		plugins: [
			magicLink({
				expiresIn: MAGIC_LINK_MINUTES * 60,
				storeToken: 'hashed',
				// Accounts are stored lowercase; send to the same address the link signs in.
				sendMagicLink: ({ email, url, metadata }) =>
					Effect.runPromise(sendMagicLinkEffect(env.EMAIL, email.trim().toLowerCase(), url, localeOf((metadata as { locale?: unknown } | undefined)?.locale))),
			}),
		],
	})
}

export type BetterAuth = ReturnType<typeof createBetterAuth>

type AuthEvent = Pick<RequestEvent, 'platform' | 'url'>

/** The Worker env SvelteKit's adapter exposes; undefined under `vite dev` without a platform proxy. */
export const platformEnv = (event: Pick<RequestEvent, 'platform'>) => (event.platform as { env?: unknown } | undefined)?.env

/** This request's Better Auth, or null when a required binding is missing. */
export function betterAuthFor(event: AuthEvent) {
	const env = platformEnv(event) as Partial<BetterAuthEnv> | undefined
	const db = boundD1Database(env)
	if (!db || !env?.AUTH_SECRET) return null
	return createBetterAuth(event.url.origin, { ...env, DB: db, AUTH_SECRET: env.AUTH_SECRET })
}

type CookieEvent = AuthEvent & Pick<RequestEvent, 'request' | 'cookies'>

/** Copies Better Auth's Set-Cookie headers (cache refresh, expiry, sign-out) onto the SvelteKit response. */
export function forwardAuthCookies(event: Pick<RequestEvent, 'cookies'>, headers: Headers) {
	for (const [name, attributes] of parseSetCookieHeader(headers.get('set-cookie') ?? '')) {
		// A lost cache cookie only costs the next request a D1 read.
		try { event.cookies.set(name, attributes.value, { ...toCookieOptions(attributes), path: attributes.path || '/' }) } catch { /* response already sent */ }
	}
}

const hasSessionCookie = (event: CookieEvent) =>
	Boolean(event.cookies.get(SESSION_COOKIE) || event.cookies.get(`__Secure-${SESSION_COOKIE}`))

/** The signed-in user, or null. Reads the signed cookie cache first and D1 when it has expired. */
export async function betterAuthUser(event: CookieEvent): Promise<{ id: string; email: string } | null> {
	if (!hasSessionCookie(event)) return null
	const auth = betterAuthFor(event)
	if (!auth) return null
	const { headers, response } = await auth.api.getSession({ headers: event.request.headers, returnHeaders: true })
	forwardAuthCookies(event, headers)
	return response ? { id: response.user.id, email: response.user.email } : null
}

/** Ends the session row and clears the cookies. */
export async function betterAuthSignOut(event: CookieEvent): Promise<void> {
	const auth = betterAuthFor(event)
	if (!auth || !hasSessionCookie(event)) return
	const { headers } = await auth.api.signOut({ headers: event.request.headers, returnHeaders: true })
	forwardAuthCookies(event, headers)
}
