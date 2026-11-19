import { error, type RequestHandler } from '@sveltejs/kit'
import { betterAuthFor } from '#features/auth/api/better-auth.server.ts'

const handle: RequestHandler = async (event) => {
	const auth = betterAuthFor(event)
	if (!auth) error(503, 'Sign-in is not configured')
	return auth.handler(event.request)
}

export const GET = handle
export const POST = handle
