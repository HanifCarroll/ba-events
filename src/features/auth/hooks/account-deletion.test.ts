import { describe, expect, it } from 'vitest'
import {
	createAccountDeletionController,
	type AccountDeletionSnapshot
} from './account-deletion.ts'

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

function until(
	controller: ReturnType<typeof createAccountDeletionController>,
	userId: string,
	predicate: (snapshot: AccountDeletionSnapshot) => boolean
) {
	return new Promise<void>((resolve) => {
		let unsubscribe: (() => void) | undefined
		let done = false
		unsubscribe = controller.subscribe(userId, (snapshot) => {
			if (!predicate(snapshot)) return
			done = true
			unsubscribe?.()
			resolve()
		})
		if (done) unsubscribe()
	})
}

describe('browser-owned account deletion', () => {
	it('continues cleanup after every page observer detaches and exposes completion on remount', async () => {
		const removal = deferred<void>()
		let signOuts = 0
		let completions = 0
		const controller = createAccountDeletionController({
			remove: () => removal.promise,
			signOut: async () => {
				signOuts++
			},
			currentUserId: () => 'a',
			completed: () => {
				completions++
			}
		})
		const detach = controller.subscribe('a', () => {})
		controller.delete('a')
		detach()
		removal.resolve()
		await until(controller, 'a', (s) => s.matches('deleted'))
		let reattached: AccountDeletionSnapshot | undefined
		const detachAgain = controller.subscribe('a', (snapshot) => {
			reattached = snapshot
		})
		expect(reattached?.matches('deleted')).toBe(true)
		expect({ signOuts, completions }).toEqual({ signOuts: 1, completions: 1 })
		detachAgain()
	})

	it('reuses an in-flight attempt and resumes only failed cleanup after remount', async () => {
		const removal = deferred<void>()
		let deletes = 0
		let signOuts = 0
		const controller = createAccountDeletionController({
			remove: () => {
				deletes++
				return removal.promise
			},
			signOut: async () => {
				if (++signOuts === 1) throw new Error('offline')
			},
			currentUserId: () => 'a',
			completed: () => {}
		})
		const detach = controller.subscribe('a', () => {})
		controller.delete('a')
		detach()
		const detachAgain = controller.subscribe('a', () => {})
		expect(controller.getSnapshot('a').matches('deleting')).toBe(true)
		controller.delete('a')
		removal.resolve()
		await until(controller, 'a', (s) => s.matches('cleanupFailed'))
		detachAgain()
		const detachRetry = controller.subscribe('a', () => {})
		controller.retryCleanup('a')
		await until(controller, 'a', (s) => s.matches('deleted'))
		expect({ deletes, signOuts }).toEqual({ deletes: 1, signOuts: 2 })
		detachRetry()
	})

	it('does not sign out or navigate a replacement account when the old deletion settles', async () => {
		const removal = deferred<void>()
		let userId: string | null = 'a'
		let signOuts = 0
		let completions = 0
		const controller = createAccountDeletionController({
			remove: () => removal.promise,
			signOut: async () => {
				signOuts++
			},
			currentUserId: () => userId,
			completed: () => {
				completions++
			}
		})
		controller.delete('a')
		userId = 'b'
		removal.resolve()
		await until(controller, 'a', (s) => s.matches('deleted'))
		expect({ signOuts, completions }).toEqual({ signOuts: 0, completions: 0 })
		expect(controller.getSnapshot('b').matches('confirming')).toBe(true)
	})

	it('also fences completion when identity changes while sign-out is awaiting its response', async () => {
		const signedOut = deferred<void>()
		let userId: string | null = 'a'
		let completions = 0
		const controller = createAccountDeletionController({
			remove: async () => {},
			signOut: () => signedOut.promise,
			currentUserId: () => userId,
			completed: () => {
				completions++
			}
		})
		controller.delete('a')
		await until(controller, 'a', (s) => s.matches('signingOut'))
		userId = 'b'
		signedOut.resolve()
		await until(controller, 'a', (s) => s.matches('deleted'))
		expect(completions).toBe(0)
	})
})
