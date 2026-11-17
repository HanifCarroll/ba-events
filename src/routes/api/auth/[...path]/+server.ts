import { error, type RequestHandler } from '@sveltejs/kit'
import { betterAuthFor, betterAuthStatus } from '#features/auth/api/better-auth.server.ts'

// Better Auth's endpoints (magic link, Google, sign-out, session) on a Worker that binds D1. Production binds none
// until the cutover and keeps Supabase Auth, so there this route doesn't exist.
const handle: RequestHandler = async (event) => {
	const status = betterAuthStatus(event)
	if (status === 'supabase') error(404, 'Not found')
	const auth = betterAuthFor(event)
	if (!auth) error(503, 'Sign-in is not configured')
	return auth.handler(event.request)
}

export const GET = handle
export const POST = handle
