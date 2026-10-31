import { describe, expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'
import { pullToRefreshMachine } from './pull-to-refresh.machine.ts'

function fixture(onRefresh = vi.fn(async () => {})) {
	return { onRefresh, actor: createActor(pullToRefreshMachine, { input: { threshold: 80, maxPull: 128, onRefresh } }).start() }
}

describe('pull-to-refresh lifecycle', () => {
	it('cancels an armed gesture without refreshing and clears its distance', () => {
		const { actor, onRefresh } = fixture()
		actor.send({ type: 'START', y: 0 })
		actor.send({ type: 'MOVE', y: 400 })
		expect(actor.getSnapshot().matches({ tracking: 'armed' })).toBe(true)
		actor.send({ type: 'CANCEL' })
		actor.send({ type: 'END' })
		expect(onRefresh).not.toHaveBeenCalled()
		expect(actor.getSnapshot().context.distance).toBe(0)
		actor.stop()
	})

	it('disarms when the user pulls back before releasing', () => {
		const { actor, onRefresh } = fixture()
		actor.send({ type: 'START', y: 100 })
		actor.send({ type: 'MOVE', y: 500 })
		actor.send({ type: 'MOVE', y: 110 })
		actor.send({ type: 'END' })
		expect(onRefresh).not.toHaveBeenCalled()
		expect(actor.getSnapshot().value).toBe('idle')
		actor.stop()
	})

	it('refreshes once and resets after an asynchronous failure', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {})
		let reject!: (reason: Error) => void
		const refresh = vi.fn(() => new Promise<void>((_, fail) => { reject = fail }))
		const { actor } = fixture(refresh)
		actor.send({ type: 'START', y: 0 })
		actor.send({ type: 'MOVE', y: 400 })
		actor.send({ type: 'END' })
		actor.send({ type: 'END' })
		actor.send({ type: 'START', y: 0 })
		expect(refresh).toHaveBeenCalledOnce()
		reject(new Error('offline'))
		await waitFor(actor, (s) => s.matches('failed'))
		expect(actor.getSnapshot().context.distance).toBe(0)
		actor.send({ type: 'START', y: 0 })
		expect(actor.getSnapshot().matches('tracking')).toBe(true)
		actor.stop()
		log.mockRestore()
	})
})
