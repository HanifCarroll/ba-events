import type { AuthUser } from '#shared/lib/types.ts'

/** Fired on `window` after this tab signs out (or deletes its account), so the auth state re-reads the session. */
export const SESSION_CHANGED_EVENT = 'baeventos:session-changed'

type SessionPayload = { user?: { id?: unknown; email?: unknown } | null } | null

/**
 * This
 * re-reads `/api/auth/get-session` when the tab regains focus or becomes visible (a magic link opened in another tab,
 * a sign-out elsewhere) and after this tab signs out, and reports the account only when it changed. Returns a stop
 * function.
 */
export function watchBetterAuthSession(deps: {
	/** `window`: focus and this tab's sign-out event. */
	target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>
	/** `document`: visibilitychange. */
	visibilityTarget: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>
	isVisible: () => boolean
	currentUserId: () => string | null
	apply: (user: AuthUser | null) => void
	fetch?: typeof fetch
}) {
	const read = deps.fetch ?? fetch
	let latest = 0
	const refresh = async () => {
		const request = ++latest
		let user: AuthUser | null
		try {
			const response = await read('/api/auth/get-session', { headers: { accept: 'application/json' }, cache: 'no-store' })
			// A failed read is not a sign-out; keep the current state and try again on the next trigger.
			if (!response.ok) return
			const body = await response.json() as SessionPayload
			user = typeof body?.user?.id === 'string'
				? { id: body.user.id, ...(typeof body.user.email === 'string' ? { email: body.user.email } : {}) }
				: null
		} catch {
			return
		}
		// An older read that finishes late must not undo a newer one.
		if (request !== latest) return
		if ((user?.id ?? null) !== deps.currentUserId()) deps.apply(user)
	}
	const onVisibility = () => { if (deps.isVisible()) void refresh() }
	const onEvent = () => void refresh()
	deps.target.addEventListener('focus', onEvent)
	deps.visibilityTarget.addEventListener('visibilitychange', onVisibility)
	deps.target.addEventListener(SESSION_CHANGED_EVENT, onEvent)
	return {
		refresh,
		stop() {
			deps.target.removeEventListener('focus', onEvent)
			deps.visibilityTarget.removeEventListener('visibilitychange', onVisibility)
			deps.target.removeEventListener(SESSION_CHANGED_EVENT, onEvent)
		},
	}
}
