import { createActor, type Actor, type SnapshotFrom } from 'xstate'
import { createAccountDeletionMachine } from './profile.machine.ts'

type DeletionMachine = ReturnType<typeof createAccountDeletionMachine>
export type AccountDeletionSnapshot = SnapshotFrom<DeletionMachine>

/**
 * Account deletion outlives a route. Observers can detach without stopping an
 * irreversible request or abandoning the sign-out step that follows it.
 */
export function createAccountDeletionController(deps: {
	remove: (userId: string) => Promise<unknown>
	signOut: () => Promise<void>
	currentUserId: () => string | null
	completed: (userId: string) => void
}) {
	const actors = new Map<string, Actor<DeletionMachine>>()
	const ownsSession = (userId: string) => {
		const currentUserId = deps.currentUserId()
		return !currentUserId || currentUserId === userId
	}
	const machine = createAccountDeletionMachine({
		remove: deps.remove,
		signOut: async (userId) => {
			if (ownsSession(userId)) await deps.signOut()
		}
	})

	function actorFor(userId: string) {
		let actor = actors.get(userId)
		if (!actor) {
			actor = createActor(machine)
			actors.set(userId, actor)
			actor.subscribe((snapshot) => {
				if (snapshot.matches('deleted') && ownsSession(userId)) deps.completed(userId)
			})
			actor.start()
		}
		return actor
	}

	return {
		getSnapshot: (userId: string) => actorFor(userId).getSnapshot(),
		subscribe(userId: string, observer: (snapshot: AccountDeletionSnapshot) => void) {
			const actor = actorFor(userId)
			const subscription = actor.subscribe(observer)
			observer(actor.getSnapshot())
			return () => subscription.unsubscribe()
		},
		delete(userId: string) {
			if (deps.currentUserId() !== userId) return
			actorFor(userId).send({ type: 'DELETE', userId })
		},
		retryCleanup(userId: string) {
			if (ownsSession(userId)) actorFor(userId).send({ type: 'RETRY_CLEANUP' })
		}
	}
}
