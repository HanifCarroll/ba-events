import { afterEach, describe, expect, it } from 'vitest'
import { createActor, SimulatedClock, waitFor, type Actor, type AnyActorLogic } from 'xstate'
import type { User } from '@supabase/supabase-js'
import type { Profile } from '#shared/lib/types.ts'
import { createAuthMachine } from './auth.machine.ts'
import { createSignInMachine, createAuthCallbackMachine } from './sign-in.machine.ts'
import { createAccountDeletionMachine, createProfileFormMachine } from './profile.machine.ts'

const actors: Actor<AnyActorLogic>[] = []
const own = <T extends AnyActorLogic>(actor: Actor<T>): Actor<T> => {
	actors.push(actor)
	actor.start()
	return actor
}
afterEach(() => {
	for (const actor of actors.splice(0)) actor.stop()
})
const user = (id: string) => ({ id }) as User
const profile = (id: string) => ({ id, role: 'user' }) as Profile
function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((done) => {
		resolve = done
	})
	return { promise, resolve }
}
const settle = async () => {
	await Promise.resolve()
	await Promise.resolve()
	await Promise.resolve()
}

describe('auth ownership', () => {
	it('ignores an old profile after account replacement and sign-out', async () => {
		const a = deferred<Profile | null>()
		const b = deferred<Profile | null>()
		const actor = own(
			createActor(
				createAuthMachine((id) => (id === 'a' ? a.promise : b.promise)),
				{ input: {} }
			)
		)
		actor.send({ type: 'SESSION_CHANGED', user: user('a') })
		actor.send({ type: 'SESSION_CHANGED', user: user('b') })
		a.resolve(profile('a'))
		await settle()
		expect(actor.getSnapshot().context).toMatchObject({ user: user('b'), profile: null })
		actor.send({ type: 'SESSION_CHANGED', user: null })
		b.resolve(profile('b'))
		await settle()
		expect(actor.getSnapshot().matches('anonymous')).toBe(true)
		expect(actor.getSnapshot().context.profile).toBeNull()
	})
	it('ignores a mutation refresh from an earlier session of the same account', () => {
		const actor = own(
			createActor(
				createAuthMachine(async () => null),
				{ input: { user: user('a') } }
			)
		)
		actor.send({ type: 'SESSION_CHANGED', user: null })
		actor.send({ type: 'SEED', value: { user: user('a'), profile: profile('a') } })
		actor.send({ type: 'PROFILE_UPDATED', userId: 'a', profile: null, revision: 0 })
		expect(actor.getSnapshot().context.profile?.id).toBe('a')
	})
	it('accepts the post-write profile after a same-account token refresh read finishes first', async () => {
		const hydration = deferred<Profile | null>()
		const oldProfile = { ...profile('a'), display_name: 'Old name' }
		const newProfile = { ...profile('a'), display_name: 'New name' }
		const actor = own(
			createActor(
				createAuthMachine(() => hydration.promise),
				{ input: { user: user('a'), profile: oldProfile } }
			)
		)
		const mutationRevision = actor.getSnapshot().context.revision
		actor.send({ type: 'SESSION_CHANGED', user: user('a') })
		hydration.resolve(oldProfile)
		await waitFor(actor, (snapshot) => snapshot.matches('authenticated'))
		actor.send({
			type: 'PROFILE_UPDATED',
			userId: 'a',
			profile: newProfile,
			revision: mutationRevision
		})
		expect(actor.getSnapshot().context.profile?.display_name).toBe('New name')
	})
	it('cancels an in-flight same-account hydration when the newer mutation refresh completes', async () => {
		const hydration = deferred<Profile | null>()
		const actor = own(
			createActor(
				createAuthMachine(() => hydration.promise),
				{ input: { user: user('a') } }
			)
		)
		const mutationRevision = actor.getSnapshot().context.revision
		actor.send({ type: 'SESSION_CHANGED', user: user('a') })
		actor.send({
			type: 'PROFILE_UPDATED',
			userId: 'a',
			profile: { ...profile('a'), display_name: 'New name' },
			revision: mutationRevision
		})
		hydration.resolve({ ...profile('a'), display_name: 'Old name' })
		await settle()
		expect(actor.getSnapshot().context.profile?.display_name).toBe('New name')
	})
	it('preserves an absent profile as null across the async actor boundary', async () => {
		const actor = own(
			createActor(
				createAuthMachine(async () => null),
				{ input: {} }
			)
		)
		actor.send({ type: 'SESSION_CHANGED', user: user('a') })
		await waitFor(actor, (snapshot) => snapshot.matches('authenticated'))
		expect(actor.getSnapshot().context.profile).toBeNull()
	})
	it('rejects stale mutation refreshes and represents profile fetch failure', async () => {
		const actor = own(
			createActor(
				createAuthMachine(async () => {
					throw new Error('offline')
				}),
				{ input: { user: user('b') } }
			)
		)
		actor.send({ type: 'PROFILE_UPDATED', userId: 'a', profile: profile('a'), revision: 0 })
		expect(actor.getSnapshot().context.profile).toBeNull()
		actor.send({ type: 'SESSION_CHANGED', user: user('b') })
		await waitFor(actor, (s) => s.matches('profileUnavailable'))
		expect(actor.getSnapshot().context.user?.id).toBe('b')
	})
})

describe('sign-in machines', () => {
	it('serializes sign-in methods and retains the submitted email', async () => {
		const sent = deferred<void>()
		let googleCalls = 0
		const actor = own(
			createActor(
				createSignInMachine({
					google: async () => {
						googleCalls++
					},
					magicLink: () => sent.promise
				})
			)
		)
		actor.send({ type: 'MAGIC_LINK', email: 'synthetic@example.com' })
		actor.send({ type: 'GOOGLE' })
		actor.send({ type: 'MAGIC_LINK', email: 'second@example.com' })
		expect(googleCalls).toBe(0)
		sent.resolve()
		await waitFor(actor, (s) => s.matches('linkSent'))
		expect(actor.getSnapshot().context.email).toBe('synthetic@example.com')
		actor.send({ type: 'RESET' })
		expect(actor.getSnapshot().matches('editing')).toBe(true)
	})
	it('does not redirect a callback whose owner has unmounted', async () => {
		const exchange = deferred<void>()
		let redirects = 0
		const actor = own(
			createActor(
				createAuthCallbackMachine({
					exchange: () => exchange.promise,
					redirect: () => {
						redirects++
					}
				})
			)
		)
		actor.send({ type: 'VERIFY', tokenHash: 'synthetic-token' })
		actor.stop()
		exchange.resolve()
		await settle()
		expect(redirects).toBe(0)
	})
})

describe('profile mutations', () => {
	it('retries only sign-out after deletion succeeds', async () => {
		let deletes = 0
		let signOuts = 0
		const actor = own(
			createActor(
				createAccountDeletionMachine({
					remove: async () => {
						deletes++
					},
					signOut: async () => {
						if (++signOuts === 1) throw new Error('offline')
					}
				})
			)
		)
		actor.send({ type: 'DELETE', userId: 'a' })
		await waitFor(actor, (s) => s.matches('cleanupFailed'))
		actor.send({ type: 'DELETE', userId: 'a' })
		expect(deletes).toBe(1)
		actor.send({ type: 'RETRY_CLEANUP' })
		await waitFor(actor, (s) => s.matches('deleted'))
		expect({ deletes, signOuts }).toEqual({ deletes: 1, signOuts: 2 })
	})
	it('cancels the old success timer when another save starts', async () => {
		const clock = new SimulatedClock()
		const second = deferred<void>()
		let saves = 0
		const actor = own(
			createActor(
				createProfileFormMachine(() => (++saves === 1 ? Promise.resolve() : second.promise)),
				{ clock }
			)
		)
		actor.send({ type: 'SAVE', name: 'First' })
		await waitFor(actor, (s) => s.matches('saved'))
		clock.increment(2000)
		actor.send({ type: 'SAVE', name: 'Second' })
		clock.increment(2000)
		expect(actor.getSnapshot().matches('saving')).toBe(true)
		second.resolve()
		await waitFor(actor, (s) => s.matches('saved'))
		clock.increment(2999)
		expect(actor.getSnapshot().matches('saved')).toBe(true)
		clock.increment(1)
		expect(actor.getSnapshot().matches('editing')).toBe(true)
	})
})
