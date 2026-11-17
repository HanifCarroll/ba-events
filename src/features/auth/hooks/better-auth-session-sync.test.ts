import { describe, expect, it } from 'vitest'
import { createActor } from 'xstate'
import type { AuthUser, Profile } from '#shared/lib/types.ts'
import { createAuthMachine } from './auth.machine.ts'
import { SESSION_CHANGED_EVENT, watchBetterAuthSession } from './better-auth-session-sync.ts'
import { createAccountDeletionController } from './account-deletion.ts'

const ALICE = '00000000-0000-4000-8000-00000000a11c'
const profileOf = (id: string) => ({ id, email: `${id}@example.test`, role: 'user' }) as Profile

/** A browser tab: the real auth actor, wired to a fake /api/auth/get-session the test controls. */
function tab(initial: AuthUser | null) {
	let server: AuthUser | null = initial
	let visible = true
	const window = new EventTarget()
	const document = new EventTarget()
	const actor = createActor(createAuthMachine(async (id) => profileOf(id)), { input: { user: initial, profile: initial ? profileOf(initial.id) : null } })
	actor.start()
	const watch = watchBetterAuthSession({
		target: window,
		visibilityTarget: document,
		isVisible: () => visible,
		currentUserId: () => actor.getSnapshot().context.user?.id ?? null,
		apply: (user) => actor.send({ type: 'SESSION_CHANGED', user }),
		fetch: (async () => Response.json(server ? { user: server, session: {} } : null)) as unknown as typeof fetch,
	})
	const settle = () => new Promise((resolve) => setTimeout(resolve, 0)).then(() => new Promise((resolve) => setTimeout(resolve, 0)))
	return {
		actor, window, document, watch, settle,
		signInElsewhere: (user: AuthUser | null) => { server = user },
		hide: () => { visible = false },
		show: () => { visible = true },
	}
}

describe('Better Auth session sync', () => {
	it('signs a tab in when the user completes a magic link in another tab and comes back', async () => {
		const t = tab(null)
		t.signInElsewhere({ id: ALICE, email: 'alice@example.test' })
		t.hide(); t.document.dispatchEvent(new Event('visibilitychange')); await t.settle()
		expect(t.actor.getSnapshot().context.user).toBeNull()
		t.show(); t.document.dispatchEvent(new Event('visibilitychange')); await t.settle()
		expect(t.actor.getSnapshot().context.user?.id).toBe(ALICE)
		expect(t.actor.getSnapshot().context.profile?.id).toBe(ALICE)
		t.watch.stop()
	})

	it('picks up a sign-out from another tab on focus', async () => {
		const t = tab({ id: ALICE })
		t.signInElsewhere(null)
		t.window.dispatchEvent(new Event('focus')); await t.settle()
		expect(t.actor.getSnapshot().context).toMatchObject({ user: null, profile: null })
		t.watch.stop()
	})

	it('keeps the account on a failed session read and does not reload an unchanged one', async () => {
		let reads = 0
		const window = new EventTarget()
		const applied: Array<AuthUser | null> = []
		const watch = watchBetterAuthSession({
			target: window, visibilityTarget: new EventTarget(), isVisible: () => true, currentUserId: () => ALICE,
			apply: (user) => applied.push(user),
			fetch: (async () => (++reads === 1 ? new Response('down', { status: 503 }) : Response.json({ user: { id: ALICE } }))) as unknown as typeof fetch,
		})
		await watch.refresh(); await watch.refresh()
		expect(reads).toBe(2)
		expect(applied).toEqual([])
		watch.stop()
	})

	it('clears the user and profile after a successful account deletion', async () => {
		const t = tab({ id: ALICE })
		const controller = createAccountDeletionController({
			remove: async () => { t.signInElsewhere(null) },
			// The client's Better Auth signOut announces the change; the auth state then re-reads the session.
			signOut: async () => { t.window.dispatchEvent(new Event(SESSION_CHANGED_EVENT)) },
			currentUserId: () => t.actor.getSnapshot().context.user?.id ?? null,
			completed: () => {},
		})
		controller.delete(ALICE)
		await new Promise<void>((resolve) => controller.subscribe(ALICE, (snapshot) => { if (snapshot.matches('deleted')) resolve() }))
		await t.settle()
		expect(t.actor.getSnapshot().context).toMatchObject({ user: null, profile: null })
		t.watch.stop()
	})
})
