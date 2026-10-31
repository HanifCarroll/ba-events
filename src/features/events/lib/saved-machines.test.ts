import { afterEach, describe, expect, it } from 'vitest'
import { createActor, waitFor, type Actor, type AnyActorLogic } from 'xstate'
import { createSavedMembershipMachine } from './saved-membership.machine.ts'
import { createSavedListMachine } from './saved-list.machine.ts'
import type { SavedEventWithDetails } from '#shared/lib/types.ts'

const actors: Actor<AnyActorLogic>[] = []
const own = <T extends AnyActorLogic>(actor: Actor<T>): Actor<T> => {
	actors.push(actor)
	actor.start()
	return actor
}
afterEach(() => {
	for (const actor of actors.splice(0)) actor.stop()
})
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

describe('saved membership', () => {
	it('waits for membership before toggling and rolls back a failed write', async () => {
		const read = deferred<boolean>()
		let writes = 0
		let failures = 0
		const actor = own(
			createActor(
				createSavedMembershipMachine({
					read: () => read.promise,
					write: async () => {
						writes++
						throw new Error('offline')
					},
					changed: () => {},
					failed: () => {
						failures++
					}
				})
			)
		)
		actor.send({ type: 'SYNC', userId: 'a', eventId: 'event', initialSaved: false })
		actor.send({ type: 'TOGGLE' })
		expect(writes).toBe(0)
		read.resolve(true)
		await waitFor(actor, (s) => s.matches('ready'))
		actor.send({ type: 'TOGGLE' })
		expect(actor.getSnapshot().context.saved).toBe(false)
		await waitFor(actor, (s) => s.matches('ready'))
		expect(actor.getSnapshot().context.saved).toBe(true)
		expect({ writes, failures }).toEqual({ writes: 1, failures: 1 })
	})
	it('does not publish an old identity mutation into a new control', async () => {
		const write = deferred<void>()
		let changes = 0
		const actor = own(
			createActor(
				createSavedMembershipMachine({
					read: async () => false,
					write: () => write.promise,
					changed: () => {
						changes++
					},
					failed: () => {}
				})
			)
		)
		actor.send({ type: 'SYNC', userId: 'a', eventId: 'one', initialSaved: false })
		await waitFor(actor, (s) => s.matches('ready'))
		actor.send({ type: 'TOGGLE' })
		actor.send({ type: 'SYNC', userId: 'b', eventId: 'two', initialSaved: false })
		write.resolve()
		await waitFor(actor, (s) => s.matches('ready'))
		expect(changes).toBe(0)
		expect(actor.getSnapshot().context).toEqual({ userId: 'b', eventId: 'two', saved: false })
	})
})

describe('saved list', () => {
	it('clears private data and ignores late loads after sign-out', async () => {
		const result = deferred<SavedEventWithDetails[]>()
		const actor = own(createActor(createSavedListMachine(() => result.promise)))
		actor.send({ type: 'IDENTITY', userId: 'a' })
		actor.send({ type: 'IDENTITY', userId: null })
		result.resolve([{ id: 'private-event' } as SavedEventWithDetails])
		await settle()
		expect(actor.getSnapshot().matches('anonymous')).toBe(true)
		expect(actor.getSnapshot().context.events).toEqual([])
	})
	it('keeps load failure distinct from an empty successful result and supports retry', async () => {
		let calls = 0
		const actor = own(
			createActor(
				createSavedListMachine(async () => {
					if (++calls === 1) throw new Error('offline')
					return []
				})
			)
		)
		actor.send({ type: 'IDENTITY', userId: 'a' })
		await waitFor(actor, (s) => s.matches('failed'))
		actor.send({ type: 'REFRESH' })
		await waitFor(actor, (s) => s.matches('ready'))
		expect(actor.getSnapshot().context.events).toEqual([])
	})
})
