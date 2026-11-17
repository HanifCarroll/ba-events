/**
 * `DB_READ_ONLY=1` freezes writes during the D1 cutover window (docs/ops/d1-cutover.md): anything written then would be
 * missing from the copy. Set it as a Worker secret, so deploys keep it, and delete it to end the window.
 */
export function isReadOnly(env: unknown): boolean {
	return (env as { DB_READ_ONLY?: unknown } | null | undefined)?.DB_READ_ONLY === '1'
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
// Remote commands that only read or end a session; SvelteKit posts them to /_app/remote/<hash>/<name>.
const SAFE_REMOTE = /^\/_app\/remote\/[^/]+\/(getProfile|signOut)$/

/**
 * The 503 for a web request that would write while read-only, or null to serve it. Reads always pass, and so do sign-in
 * and sign-out (`/api/auth/*` and the profile read, needed for the magic-link smoke test). Guest chat keeps working: its history lives in
 * the browser, and only guests may post to `/api/chat*`. Every other write is refused, signed in or not.
 */
export function readOnlyResponse(env: unknown, method: string, pathname: string, signedIn: boolean): Response | null {
	if (!isReadOnly(env) || SAFE_METHODS.has(method)) return null
	if (pathname.startsWith('/api/auth/') || SAFE_REMOTE.test(pathname)) return null
	if (!signedIn && (pathname === '/api/chat' || pathname.startsWith('/api/chat/'))) return null
	return Response.json(
		{ error: 'BA Eventos is being updated. Saving is paused for a few minutes; please try again soon.' },
		{ status: 503, headers: { 'Retry-After': '600', 'Cache-Control': 'no-store' } },
	)
}
